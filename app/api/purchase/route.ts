import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { openSession, commit, logAudit, logCredit } from "@/lib/store";
import { evaluate, createRng } from "@/lib/bandit";
import { cohortSeed } from "@/lib/cohort-seed";
import { reportCharge } from "@/lib/prava";
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
import type { PurchaseEvent } from "@/lib/store";

export const maxDuration = 60;

interface PurchaseBody {
  amount?: string;
  reason?: string;
  winnerId?: string;
  probabilityBest?: number;
  impressions?: number;
  force?: boolean | "merchant";
  state?: unknown;
}

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

const MAX_PLAUSIBLE_IMPRESSIONS = 5000000;
const MAX_PLAUSIBLE_CTR = 0.25;
const CTR_CHECK_FLOOR = 50;

function normalizeAmount(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function packPrice(): number {
  const n = Number(process.env.RENDER_CREDIT_PRICE ?? "4.00");
  return Number.isFinite(n) && n > 0 ? n : 4;
}

function implausibility(cohort: { arm: { impressions: number; clicks: number } }[]): string | null {
  const impressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const clicks = cohort.reduce((sum, c) => sum + c.arm.clicks, 0);
  if (impressions > MAX_PLAUSIBLE_IMPRESSIONS) {
    return `${impressions.toLocaleString("en-US")} impressions across the cohort, more than any run here ever serves`;
  }
  if (clicks > impressions) {
    return `${clicks.toLocaleString("en-US")} clicks on ${impressions.toLocaleString("en-US")} impressions`;
  }
  const hot = cohort.find(
    (c) => c.arm.impressions >= CTR_CHECK_FLOOR && c.arm.clicks / c.arm.impressions > MAX_PLAUSIBLE_CTR,
  );
  if (hot) {
    const rate = ((hot.arm.clicks / hot.arm.impressions) * 100).toFixed(1);
    return `a ${rate}% click through rate on one arm, far above anything the traffic model can produce`;
  }
  return null;
}

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as PurchaseBody;

  const session = openSession(body.state);
  const state = session.state;

  const generation = state.creatives.length
    ? Math.max(...state.creatives.map((c) => c.generation))
    : -1;
  const cohort = state.creatives.filter((c) => c.generation === generation);

  if (cohort.length === 0) {
    return NextResponse.json(
      {
        error:
          "there is nothing to buy for: the request carries no creatives, so no evidence can justify a charge. The agent only spends against a cohort it has measured.",
        code: "NO_EVIDENCE",
      },
      { status: 400 },
    );
  }

  if (cohort.length < 2) {
    logAudit(
      state,
      "purchase",
      `Refused the purchase request before touching any mandate: generation ${generation} carries a single creative, and one arm is not a comparison. The agent spends on a variant that beat another one, never on a variant that ran alone.`,
    );
    return NextResponse.json(
      {
        error:
          "the evidence does not justify a charge: the live generation carries a single creative, so there is nothing it was measured against. A cohort needs at least two variants before the bandit can call a winner, and the server does not spend on a comparison that never happened.",
        code: "COHORT_TOO_SMALL",
        cohortSize: cohort.length,
        state: commit(session),
      },
      { status: 409 },
    );
  }

  const implausible = implausibility(cohort);
  if (implausible) {
    logAudit(
      state,
      "purchase",
      `Refused the purchase request before touching any mandate: the incoming evidence claims ${implausible}. The server does not spend against evidence it cannot believe.`,
    );
    return NextResponse.json(
      {
        error: `The server does not accept implausible evidence: the incoming state claims ${implausible}, so the request was refused before any mandate was touched.`,
        code: "IMPLAUSIBLE_EVIDENCE",
        state: commit(session),
      },
      { status: 422 },
    );
  }

  const forceCap = body.force === true;
  const forceMerchant = body.force === "merchant";
  const force = forceCap || forceMerchant;

  const verdict = evaluate(
    cohort.map((c) => c.arm),
    {
      samples: 20000,
      candidateRule: "probabilityBest",
      rng: createRng(cohortSeed(cohort)),
    },
  );

  if (!force && !verdict.sufficientEvidence) {
    return NextResponse.json(
      {
        error:
          "the evidence does not justify a charge. The agent re-checks the bandit on the server before it spends, and the gates are not open on this cohort.",
        code: "EVIDENCE_INSUFFICIENT",
        evaluation: verdict,
      },
      { status: 409 },
    );
  }

  const provenWinner = cohort[verdict.candidateIndex]?.id ?? null;
  const provenProbability = verdict.probabilityBest;
  const provenImpressions = verdict.totalImpressions;

  if (!forceMerchant && !state.mandateId) {
    return NextResponse.json(
      {
        error:
          "no mandate on file, so the agent has nothing to charge. The seller has to sign the mandate first: create the session, approve it with the passkey, then set PRAVA_MANDATE_ID or store the mandate id on the state.",
      },
      { status: 400 },
    );
  }

  const preferredId = state.mandateId;
  const requested = normalizeAmount(body.amount);

  if (!force && !requested) {
    return NextResponse.json(
      { error: "amount is required and has to be a positive decimal string, for example \"12.00\"" },
      { status: 400 },
    );
  }

  if (!force && requested && Number(requested) > packPrice()) {
    return NextResponse.json(
      {
        error: `The agent asked to charge ${requested} for one pack of render credits, and a pack costs ${packPrice().toFixed(2)}. The charge was never sent. The mandate ceiling is the seller's limit, not this product's price list, so the price of what the agent is buying is enforced here rather than left to the card network to catch.`,
        code: "AMOUNT_ABOVE_LIST_PRICE",
      },
      { status: 422 },
    );
  }

  let queue: MandateQueue;
  let attempts: MandateCandidate[];
  let amount: string;
  let chargeContext: ChargeContext | undefined;

  if (forceMerchant) {
    const demo = await merchantDemoTarget(process.env.PRAVA_USER_ID);
    if (!demo) {
      return NextResponse.json(
        { error: MERCHANT_MANDATE_MISSING_MESSAGE, code: MERCHANT_MANDATE_MISSING },
        { status: 409 },
      );
    }
    queue = {
      all: [demo],
      candidates: [demo],
      skipped: [],
      foreign: [],
      reserved: null,
      listError: null,
    };
    attempts = [demo];
    amount = scopeDemoAmount(demo);
    chargeContext = renderCreditsContext(amount);
  } else {
    queue = await mandateQueue(
      forceCap ? 0 : Number(requested),
      preferredId,
      process.env.PRAVA_USER_ID,
    );
    const target = forceCap ? rejectionTarget(queue, preferredId) : null;
    attempts = forceCap ? (target ? [target] : []) : queue.candidates;
    amount = forceCap ? overCapAmount(target) : requested!;
    if (!forceCap) chargeContext = renderCreditsContext(amount);
  }

  const winnerId = provenWinner ?? body.winnerId?.trim() ?? "unknown_creative";
  const reason =
    body.reason?.trim() ||
    (forceMerchant
      ? `Deliberate ${amount} charge for a merchant outside the mandate's list to prove the merchant lock holds`
      : forceCap
        ? `Deliberate over-cap charge of ${amount} to prove the mandate ceiling holds`
        : "Bandit called the winner and bought more render credits");
  const probabilityBest = provenProbability;
  const impressions = provenImpressions;
  const baseReference = `banditd_${cohortSeed(cohort)}_g${generation}_${amount.replace(".", "")}`;

  if (queue.listError) {
    logAudit(
      state,
      "mandate",
      `Prava did not answer when listing the signed mandates (${queue.listError}), falling back to the mandate on file`,
    );
  }

  if (forceCap && attempts.length) {
    logAudit(
      state,
      "purchase",
      `Forcing a ${amount} charge against the ${attempts[0].approvedAmount.toFixed(2)} ceiling on reserved mandate ${attempts[0].id} to show the guardrail rejecting the agent`,
    );
  }

  if (forceMerchant && attempts.length) {
    logAudit(
      state,
      "purchase",
      `Forcing a ${amount} render credits charge against mandate ${attempts[0].id}, which the seller signed for ${DEMO_MERCHANT_NAME} only, to show the merchant scope guardrail rejecting the agent`,
    );
  }

  if (!force && queue.foreign.length) {
    logAudit(
      state,
      "mandate",
      `${queue.foreign.length} signed mandate(s) are outside the render credits merchant (${queue.foreign.map((m) => `${m.id} signed for ${m.merchantName ?? "an unnamed merchant"}`).join("; ")}) and the agent never charges them for render credits, they stay out of the queue`,
    );
  }

  if (!force && queue.skipped.length) {
    logAudit(
      state,
      "mandate",
      `${queue.skipped.length} signed mandate(s) are out for this cycle (${queue.skipped.map((m) => `${m.id} ${m.chargedThisCycle ? "already charged this cycle" : `only ${m.remaining.toFixed(2)} left`}`).join("; ")}), ${queue.candidates.length} still usable`,
    );
  }

  const rotation = await chargeWithRotation(attempts, amount, baseReference, chargeContext).catch(
    (e: unknown): RotationResult => ({
      charge: {
        ok: false,
        code: PROVIDER_UNREACHABLE,
        message: e instanceof Error ? e.message : String(e),
        httpStatus: 0,
        mandateId: attempts[0]?.id,
      },
      mandateId: attempts[0]?.id ?? null,
      reference: baseReference,
      rotated: [],
    }),
  );

  for (const skipped of rotation.rotated) {
    logAudit(
      state,
      "mandate",
      `Mandate ${skipped.mandateId} was already charged in this cycle, rotating to the next signed mandate without touching the run`,
    );
  }

  const mandateId = rotation.mandateId;
  const reference = rotation.reference ?? baseReference;
  const result = rotation.charge;

  if (!result || !result.ok) {
    const code = result ? result.code : NO_MANDATE_AVAILABLE;
    const family = declineFamily(code);
    const message = result
      ? (DECLINE_MESSAGES[code] ?? fallbackMessage(code, result.message ?? null, result.httpStatus))
      : exhaustionMessage(queue, amount);

    const event: PurchaseEvent = {
      id: `pu_${Date.now()}`,
      at: new Date().toISOString(),
      amount,
      reason,
      winnerId,
      probabilityBest,
      impressions,
      ok: false,
      errorCode: code,
      cardLast4: null,
      transactionId: result?.transactionId ?? null,
      mandateId,
    };

    state.purchases.unshift(event);

    const upstream = result && result.httpStatus > 0 ? `upstream HTTP ${result.httpStatus}, ` : "";

    logAudit(
      state,
      "purchase",
      result
        ? family === "guardrail"
          ? `Declined ${amount} on mandate ${mandateId}: ${code}. ${message} (${upstream}reference ${reference})`
          : family === "request"
            ? `Could not charge ${amount} on mandate ${mandateId}: Prava rejected the request itself with ${code}, no mandate rule was involved. ${message} (${upstream}reference ${reference})`
            : `Could not charge ${amount} on mandate ${mandateId}: ${code} came back from the payment provider, not from a mandate rule. ${message} (${upstream}reference ${reference})`
        : `Held back ${amount}: ${code}. ${message} (${rotation.rotated.length} signed mandate(s) tried and already charged this cycle, reference ${reference})`,
    );

    return NextResponse.json({
      ...commit(session),
      lastPurchase: {
        ok: false,
        amount,
        reason,
        winnerId,
        errorCode: code,
        family,
        message,
        upstreamMessage: result?.message ?? null,
        upstreamStatus: result?.httpStatus ?? null,
        mandateId,
        rotatedPast: rotation.rotated.map((r) => r.mandateId),
        forced: force,
        reference,
      },
    });
  }

  const usedMandateId = mandateId ?? result.mandateId;
  const token = result.credentials.token ?? "";
  const cardLast4 = token.length >= 4 ? token.slice(-4) : null;
  const transactionId = result.transactionId || null;

  const event: PurchaseEvent = {
    id: `pu_${Date.now()}`,
    at: new Date().toISOString(),
    amount,
    reason,
    winnerId,
    probabilityBest,
    impressions,
    ok: true,
    errorCode: null,
    cardLast4,
    transactionId,
    mandateId: usedMandateId,
  };

  state.purchases.unshift(event);
  if (!forceMerchant) state.mandateId = usedMandateId;

  logAudit(
    state,
    "purchase",
    `Charged ${amount} on mandate ${usedMandateId} for "${reason}" on card ending ${cardLast4 ?? "????"}${result.deduplicated ? ", deduplicated by reference" : ""} (txn ${transactionId ?? "n/a"}, reference ${reference})`,
  );

  const creditedRenders = Math.max(0, Math.floor(Number(amount)));
  const balanceBefore = state.credits.balance;
  if (creditedRenders > 0) {
    logCredit(state, "purchase", creditedRenders, transactionId ?? reference);
    logAudit(
      state,
      "credits",
      `The ${amount} charge delivered ${creditedRenders} render credits at one dollar per render, balance now ${state.credits.balance}`,
    );
  }

  const delivered = creditedRenders > 0 && state.credits.balance - balanceBefore === creditedRenders;

  let reported = false;
  let reportError: string | null = null;

  if (transactionId) {
    try {
      await reportCharge(usedMandateId, transactionId, delivered, amount);
      reported = true;
    } catch (e) {
      reportError = e instanceof Error ? e.message : String(e);
    }
  } else {
    reportError = "the charge came back without a transaction id, so there was nothing to report";
  }

  if (reported && delivered) {
    logAudit(
      state,
      "purchase",
      `Reported transaction ${transactionId} on mandate ${usedMandateId} to Prava as APPROVED for ${amount}, after the ${creditedRenders} render credits landed in the ledger. ${SELF_DECLARED_OUTCOME}`,
    );
  }

  if (reported && !delivered) {
    logAudit(
      state,
      "purchase",
      `The charge went through but the render credits never landed in the ledger, so transaction ${transactionId} was reported to Prava as DECLINED for ${amount}. Nothing was delivered and the outcome sent to the network says so.`,
    );
  }

  if (reportError) {
    logAudit(
      state,
      "purchase",
      `The charge went through but reporting it back to the mandate failed: ${reportError}. The mandate may still count this charge as open.`,
    );
  }

  return NextResponse.json({
    ...commit(session),
    lastPurchase: {
      ok: true,
      amount,
      reason,
      winnerId,
      transactionId,
      cardLast4,
      creditedRenders,
      mandateId: usedMandateId,
      rotatedPast: rotation.rotated.map((r) => r.mandateId),
      status: result.status,
      deduplicated: result.deduplicated,
      reported,
      reportError,
      reportedStatus: reported ? "APPROVED" : null,
      merchant: {
        name: renderCreditsContext(amount).merchantName,
        firstParty: true,
        outcomeSelfDeclared: true,
        note: SELF_DECLARED_OUTCOME,
      },
      forced: force,
      reference,
    },
  });
}
