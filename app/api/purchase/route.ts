import { NextResponse } from "next/server";
import { logAudit, logCredit, liveCohort } from "@/lib/store";
import type { State } from "@/lib/store";
import { evaluate, createRng } from "@/lib/bandit";
import { cohortSeed } from "@/lib/cohort-seed";
import { reportCharge, CHARGE_OUTCOME_UNKNOWN } from "@/lib/prava";
import { guard, operatorAllowed } from "@/lib/access";
import { safeError, logUpstream } from "@/lib/redact";
import { updateRun } from "@/lib/run-store";
import type { RunRecord } from "@/lib/run-store";
import type { Client } from "@/lib/access";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { PurchaseInput } from "@/lib/contracts";
import {
  mandateQueue,
  chargeWithRotation,
  rejectionTarget,
  overCapAmount,
  exhaustionMessage,
  merchantDemoTarget,
  scopeDemoAmount,
  renderCreditsContext,
  NO_MANDATE_AVAILABLE,
  NO_MANDATE_MESSAGE,
  MERCHANT_MANDATE_MISSING,
  MERCHANT_MANDATE_MISSING_MESSAGE,
  DEMO_MERCHANT_NAME,
} from "@/lib/mandate";
import { declineFamily, PROVIDER_UNREACHABLE } from "@/lib/declines";
import type { MandateQueue, MandateCandidate, RotationResult } from "@/lib/mandate";
import type { ChargeContext } from "@/lib/prava";

export const maxDuration = 60;

// Leave room under maxDuration for the listing, the report and the final write.
const CHARGE_WINDOW_MS = 40000;
// How long a run stays locked to one charge in flight.
const PURCHASE_LOCK_MS = (maxDuration + 5) * 1000;

const DECLINE_MESSAGES: Record<string, string> = {
  THRESHOLD_EXCEEDED:
    "Visa declined the charge: the amount is above the per-charge ceiling the seller signed on this mandate. Nothing was spent and the mandate is still live. Charge less than the cap, or ask the seller to sign a wider mandate.",
  MANDATE_MERCHANT_NOT_ALLOWED:
    "The mandate is scoped to a listed merchant and the render credits merchant is not on that list. Nothing was spent. The seller has to sign a mandate that names this merchant, or one with merchant scope set to any.",
  MANDATE_NOT_ACTIVE:
    "The mandate is no longer usable: it was consumed, paused, revoked or it expired. Nothing was spent. The seller has to sign a fresh mandate before the agent can buy again.",
  TRIES_EXHAUSTED:
    "The mandate has no charges left, its max_charges allowance is spent. Nothing was spent on this attempt. The seller has to sign a fresh mandate.",
  CYCLE_ALREADY_CHARGED:
    "This mandate was already charged in the current monthly cycle, and Prava allows one charge per cycle. Nothing was spent. The agent moves to the next signed mandate, or the seller signs another one.",
  [NO_MANDATE_AVAILABLE]: NO_MANDATE_MESSAGE,
  FETCH_AGENTIC_CREDS_ERROR:
    "The charge could not be processed on the payment provider side: Prava failed to fetch the agentic credentials from Visa, so no single use card was ever issued and the charge never reached one. No rule on the mandate refused this spend and nothing was spent. Prava can still count the attempt against this mandate's cycle, so the agent moves to the next signed mandate instead of retrying this one.",
  NO_TOKEN:
    "Prava returned the charge without card credentials, so there was nothing to charge. Nothing was spent and no rule on the mandate refused it. The failure is on the payment provider side and the same charge can go out again once it returns a card.",
  VISA_CONFIRMATION_FAILED:
    "The charge went out and Visa never confirmed the result, so the payment provider could not close it. No rule on the mandate refused this spend. Check the transaction reference on the Prava side before charging again.",
  [CHARGE_OUTCOME_UNKNOWN]:
    "The charge was sent and Prava did not answer in time, so whether a card was issued is unknown. Nothing is credited until it is known. Look the charge up on the Prava side by its reference before charging again.",
  [PROVIDER_UNREACHABLE]:
    "The payment provider failed on its own side, so the charge could not be completed. Nothing was spent and no rule on the mandate refused it: what broke is Prava, not the authorization the seller signed.",
};

function fallbackMessage(code: string, upstream: string | null, status: number): string {
  const answered = status > 0 ? ` Prava answered HTTP ${status}.` : "";
  const said = upstream ? ` Prava said: ${upstream}` : "";
  const detail = `${answered}${said}`;
  const family = declineFamily(code);
  if (family === "provider") {
    return `The charge could not be processed on the payment provider side (${code}). Nothing was spent and no rule on the mandate refused this spend.${detail}`;
  }
  if (family === "request") {
    return `Prava rejected the request itself (${code}): the call was malformed on our side, it was not a mandate rule stopping the spend. Nothing was spent.${detail}`;
  }
  return `The charge did not complete (${code}) and Prava did not say whether a rule on the mandate stopped it or the payment side failed, so this is not proof the guardrail refused anything. Nothing was spent.${detail}`;
}

const SELF_DECLARED_OUTCOME =
  "The render credits merchant is a first party demo destination this project operates, not an independent store, so the APPROVED outcome is self declared by us and not confirmed by a separate acquirer. What is not self declared is the charge: the mandate, the ceiling, the merchant scope and the single use card all come from the Visa network through Prava, and the credits it delivered are debited for real on every render.";

function normalizeAmount(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function refused(code: string, status: number, message: string, state?: State, extra: Record<string, unknown> = {}) {
  return new HttpFailure(code, status, message, { extra: { ...extra, ...(state ? { state } : {}) } });
}

function packPrice(): number {
  const n = Number(process.env.RENDER_CREDIT_PRICE ?? "4.00");
  return Number.isFinite(n) && n > 0 ? n : 4;
}

type Force = true | "merchant" | null;

interface PurchaseRequest {
  runId: string;
  amount?: string;
  reason?: string;
  force: Force;
}

/**
 * Charges the seller's mandate for render credits. The evidence is the cohort
 * the server measured and stored, never numbers from the request; the mandate
 * comes from Prava's live listing or the one the server has on file. One
 * charge per run can be in flight at a time.
 */
export async function POST(req: Request) {
  try {
    const client = await guard(req, "purchase");
    const body = await readJson(req, PurchaseInput);
    const force: Force = body.force ?? null;
    if (force && !operatorAllowed(req)) {
      throw new HttpFailure(
        "FORCE_DISABLED",
        403,
        "The guardrail demo charges are switched off on this deployment. They spend against real mandates, so in production they need DEMO_FORCE=1 and the operator's admin token. Nothing was charged.",
      );
    }

    const claim = await updateRun(body.runId, client, (record) => {
      if (record.purchaseUntil !== null && record.purchaseUntil > Date.now()) {
        throw new HttpFailure(
          "PURCHASE_IN_FLIGHT",
          409,
          "A charge for this run is already in flight. Wait for it to come back before asking for another one. Nothing was charged by this request.",
          { retryAfterSeconds: Math.ceil((record.purchaseUntil - Date.now()) / 1000) },
        );
      }
      record.purchaseUntil = Date.now() + PURCHASE_LOCK_MS;
    });

    try {
      return await purchase(claim.record, { ...body, force }, client);
    } finally {
      await updateRun(body.runId, client, (record) => {
        record.purchaseUntil = null;
      }).catch((e) => console.error("could not release the purchase lock", e));
    }
  } catch (err) {
    return failure(err);
  }
}

async function note(runId: string, client: Client, kind: string, detail: string): Promise<State> {
  const { record } = await updateRun(runId, client, ({ state }) => logAudit(state, kind, detail));
  return record.state;
}

async function purchase(locked: RunRecord, body: PurchaseRequest, client: Client): Promise<Response> {
  const started = Date.now();
  const { runId, force } = body;
  const state = locked.state;
  const cohort = liveCohort(state);

  if (cohort.length === 0) {
    throw refused(
      "NO_EVIDENCE",
      400,
      "there is nothing to buy for: this run has no creatives, so no evidence can justify a charge. The agent only spends against a cohort it has measured.",
    );
  }
  const generation = cohort[0].generation;

  const verdict = evaluate(
    cohort.map((c) => c.arm),
    { samples: 20000, candidateRule: "probabilityBest", rng: createRng(cohortSeed(cohort)) },
  );

  if (verdict.cohortProblem === "COHORT_TOO_SMALL") {
    const latest = await note(
      runId,
      client,
      "purchase",
      `Refused the purchase request before touching any mandate: generation ${generation} carries a single creative, and one arm is not a comparison. The agent spends on a variant that beat another one, never on a variant that ran alone.`,
    );
    throw refused(
      "COHORT_TOO_SMALL",
      409,
      "the evidence does not justify a charge: the live generation carries a single creative, so there is nothing it was measured against. A cohort needs at least two variants before the bandit can call a winner, and the server does not spend on a comparison that never happened.",
      latest,
      { cohortSize: cohort.length },
    );
  }

  if (!force && !verdict.sufficientEvidence) {
    throw refused(
      "EVIDENCE_INSUFFICIENT",
      409,
      "the evidence does not justify a charge. The agent re-checks the bandit on the server before it spends, and the gates are not open on this cohort.",
      undefined,
      { evaluation: verdict },
    );
  }

  const forceCap = force === true;
  const forceMerchant = force === "merchant";
  const preferredId = state.mandateId;
  const requested = normalizeAmount(body.amount ?? packPrice().toFixed(2));

  if (!force && !requested) {
    throw refused("BAD_AMOUNT", 400, 'amount has to be a positive decimal string, for example "4.00"');
  }
  if (!force && requested && Number(requested) > packPrice()) {
    throw refused(
      "AMOUNT_ABOVE_LIST_PRICE",
      422,
      `The agent asked to charge ${requested} for one pack of render credits, and a pack costs ${packPrice().toFixed(2)}. The charge was never sent. The mandate ceiling is the seller's limit, not this product's price list, so the price of what the agent is buying is enforced here rather than left to the card network to catch.`,
    );
  }

  let queue: MandateQueue;
  let attempts: MandateCandidate[];
  let amount: string;
  let chargeContext: ChargeContext | undefined;

  if (forceMerchant) {
    const demo = await merchantDemoTarget(process.env.PRAVA_USER_ID);
    if (!demo) throw refused(MERCHANT_MANDATE_MISSING, 409, MERCHANT_MANDATE_MISSING_MESSAGE);
    queue = { all: [demo], candidates: [demo], skipped: [], foreign: [], reserved: null, listError: null };
    attempts = [demo];
    amount = scopeDemoAmount(demo);
    chargeContext = renderCreditsContext(amount);
  } else {
    queue = await mandateQueue(forceCap ? 0 : Number(requested), preferredId, process.env.PRAVA_USER_ID);
    const target = forceCap ? rejectionTarget(queue) : null;
    attempts = forceCap ? (target ? [target] : []) : queue.candidates;
    amount = forceCap ? overCapAmount(target) : requested!;
    if (!forceCap) chargeContext = renderCreditsContext(amount);
  }

  const provenWinner = cohort[verdict.candidateIndex]?.id ?? "unknown_creative";
  const reason =
    body.reason ||
    (forceMerchant
      ? `Deliberate ${amount} charge for a merchant outside the mandate's list to prove the merchant lock holds`
      : forceCap
        ? `Deliberate over-cap charge of ${amount} to prove the mandate ceiling holds`
        : "Bandit called the winner and bought more render credits");
  const baseReference = `banditd_${cohortSeed(cohort)}_g${generation}_${amount.replace(".", "")}`;

  const notes: string[] = [];
  if (queue.listError) {
    notes.push(
      `Prava did not answer when listing the signed mandates (${safeError(queue.listError)}), ${attempts.length ? "falling back to the mandate on file" : "and there is no mandate on file to fall back to"}`,
    );
  }
  if (forceCap && attempts.length) {
    notes.push(
      `Forcing a ${amount} charge against the ${attempts[0].approvedAmount.toFixed(2)} ceiling on reserved mandate ${attempts[0].id} to show the guardrail rejecting the agent`,
    );
  }
  if (forceMerchant && attempts.length) {
    notes.push(
      `Forcing a ${amount} render credits charge against mandate ${attempts[0].id}, which the seller signed for ${DEMO_MERCHANT_NAME} only, to show the merchant scope guardrail rejecting the agent`,
    );
  }
  if (!force && queue.foreign.length) {
    notes.push(
      `${queue.foreign.length} signed mandate(s) are outside the render credits merchant (${queue.foreign.map((m) => `${m.id} signed for ${m.merchantName ?? "an unnamed merchant"}`).join("; ")}) and the agent never charges them for render credits, they stay out of the queue`,
    );
  }
  if (!force && queue.skipped.length) {
    notes.push(
      `${queue.skipped.length} signed mandate(s) are out for this cycle (${queue.skipped.map((m) => `${m.id} ${m.chargedThisCycle ? "already charged this cycle" : `only ${m.remaining.toFixed(2)} left`}`).join("; ")}), ${queue.candidates.length} still usable`,
    );
  }

  const rotation = await chargeWithRotation(
    attempts,
    amount,
    baseReference,
    chargeContext,
    started + CHARGE_WINDOW_MS,
  ).catch((e: unknown): RotationResult => {
    logUpstream("purchase rotation", e);
    return {
      charge: {
        ok: false,
        code: PROVIDER_UNREACHABLE,
        message: safeError(e),
        httpStatus: 0,
        mandateId: attempts[0]?.id,
      },
      mandateId: attempts[0]?.id ?? null,
      reference: baseReference,
      rotated: [],
    };
  });

  for (const skipped of rotation.rotated) {
    notes.push(
      `Mandate ${skipped.mandateId} was already charged in this cycle, rotating to the next signed mandate without touching the run`,
    );
  }

  const mandateId = rotation.mandateId;
  const reference = rotation.reference ?? baseReference;
  const result = rotation.charge;
  const probabilityBest = verdict.probabilityBest;
  const impressions = verdict.totalImpressions;

  if (!result || !result.ok) {
    const code = result ? result.code : NO_MANDATE_AVAILABLE;
    const family = declineFamily(code);
    const message = result
      ? (DECLINE_MESSAGES[code] ?? fallbackMessage(code, result.message ? safeError(result.message) : null, result.httpStatus))
      : exhaustionMessage(queue, amount);
    const upstream = result && result.httpStatus > 0 ? `upstream HTTP ${result.httpStatus}, ` : "";

    const { record } = await updateRun(runId, client, ({ state: latest }) => {
      for (const line of notes) logAudit(latest, line.startsWith("Forcing") ? "purchase" : "mandate", line);
      latest.purchases.unshift({
        id: `pu_${Date.now()}`,
        at: new Date().toISOString(),
        amount,
        reason,
        winnerId: provenWinner,
        probabilityBest,
        impressions,
        ok: false,
        errorCode: code,
        cardLast4: null,
        transactionId: result?.transactionId ?? null,
        mandateId,
      });
      logAudit(
        latest,
        "purchase",
        result
          ? family === "guardrail"
            ? `Declined ${amount} on mandate ${mandateId}: ${code}. ${message} (${upstream}reference ${reference})`
            : family === "request"
              ? `Could not charge ${amount} on mandate ${mandateId}: Prava rejected the request itself with ${code}, no mandate rule was involved. ${message} (${upstream}reference ${reference})`
              : `Could not charge ${amount} on mandate ${mandateId}: ${code} came back from the payment provider, not from a mandate rule. ${message} (${upstream}reference ${reference})`
          : `Held back ${amount}: ${code}. ${message} (${rotation.rotated.length} signed mandate(s) tried and already charged this cycle, reference ${reference})`,
      );
    });

    return NextResponse.json({
      ...record.state,
      lastPurchase: {
        ok: false,
        amount,
        reason,
        winnerId: provenWinner,
        errorCode: code,
        family,
        message,
        upstreamMessage: result?.message ? safeError(result.message) : null,
        upstreamStatus: result?.httpStatus ?? null,
        mandateId,
        rotatedPast: rotation.rotated.map((r) => r.mandateId),
        forced: Boolean(force),
        reference,
      },
    });
  }

  const usedMandateId = mandateId ?? result.mandateId;
  const token = result.credentials.token ?? "";
  const cardLast4 = token.length >= 4 ? token.slice(-4) : null;
  const transactionId = result.transactionId || null;
  const creditedRenders = Math.max(0, Math.floor(Number(amount)));
  const creditRef = transactionId ?? reference;

  const charged = await updateRun(runId, client, ({ state: latest }) => {
    for (const line of notes) logAudit(latest, line.startsWith("Forcing") ? "purchase" : "mandate", line);
    latest.purchases.unshift({
      id: `pu_${Date.now()}`,
      at: new Date().toISOString(),
      amount,
      reason,
      winnerId: provenWinner,
      probabilityBest,
      impressions,
      ok: true,
      errorCode: null,
      cardLast4,
      transactionId,
      mandateId: usedMandateId,
    });
    if (!forceMerchant) latest.mandateId = usedMandateId;
    logAudit(
      latest,
      "purchase",
      `Charged ${amount} on mandate ${usedMandateId} for "${reason}" on card ending ${cardLast4 ?? "????"}${result.deduplicated ? ", deduplicated by reference" : ""} (txn ${transactionId ?? "n/a"}, reference ${reference})`,
    );
    // Prava deduplicates by reference, so the same charge can come back twice:
    // its credits land once.
    const already = latest.credits.entries.some((e) => e.kind === "purchase" && e.ref === creditRef);
    if (creditedRenders > 0 && !already) {
      logCredit(latest, "purchase", creditedRenders, creditRef);
      logAudit(
        latest,
        "credits",
        `The ${amount} charge delivered ${creditedRenders} render credits at one dollar per render, balance now ${latest.credits.balance}`,
      );
    }
    return creditedRenders > 0;
  });
  const delivered = charged.result;

  let reported = false;
  let reportError: string | null = null;
  if (transactionId) {
    try {
      await reportCharge(usedMandateId, transactionId, delivered, amount);
      reported = true;
    } catch (e) {
      logUpstream("prava report", e);
      reportError = safeError(e);
    }
  } else {
    reportError = "the charge came back without a transaction id, so there was nothing to report";
  }

  const { record } = await updateRun(runId, client, ({ state: latest }) => {
    if (reported && delivered) {
      logAudit(
        latest,
        "purchase",
        `Reported transaction ${transactionId} on mandate ${usedMandateId} to Prava as APPROVED for ${amount}, after the ${creditedRenders} render credits landed in the ledger. ${SELF_DECLARED_OUTCOME}`,
      );
    }
    if (reported && !delivered) {
      logAudit(
        latest,
        "purchase",
        `The charge went through but no render credits were delivered for it, so transaction ${transactionId} was reported to Prava as DECLINED for ${amount}. Nothing was delivered and the outcome sent to the network says so.`,
      );
    }
    if (reportError) {
      logAudit(
        latest,
        "purchase",
        `The charge went through but reporting it back to the mandate failed: ${reportError}. The mandate may still count this charge as open.`,
      );
    }
  });

  return NextResponse.json({
    ...record.state,
    lastPurchase: {
      ok: true,
      amount,
      reason,
      winnerId: provenWinner,
      transactionId,
      cardLast4,
      creditedRenders,
      mandateId: usedMandateId,
      rotatedPast: rotation.rotated.map((r) => r.mandateId),
      status: result.status,
      deduplicated: result.deduplicated,
      reported,
      reportError,
      reportedStatus: reported ? (delivered ? "APPROVED" : "DECLINED") : null,
      merchant: {
        name: renderCreditsContext(amount).merchantName,
        firstParty: true,
        outcomeSelfDeclared: true,
        note: SELF_DECLARED_OUTCOME,
      },
      forced: Boolean(force),
      reference,
    },
  });
}
