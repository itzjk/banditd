import { NextResponse } from "next/server";
import { openSession, commit, logAudit } from "@/lib/store";
import { evaluate } from "@/lib/bandit";
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
import type { MandateQueue, MandateCandidate } from "@/lib/mandate";
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
};

function normalizeAmount(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

export async function POST(req: Request) {
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

  const forceCap = body.force === true;
  const forceMerchant = body.force === "merchant";
  const force = forceCap || forceMerchant;

  const verdict = evaluate(
    cohort.map((c) => c.arm),
    { samples: 20000, candidateRule: "probabilityBest" },
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
    queue = { all: [demo], candidates: [demo], skipped: [], reserved: null, listError: null };
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
  const baseReference = `banditd_${Date.now()}_${winnerId}`;

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

  if (!force && queue.skipped.length) {
    logAudit(
      state,
      "mandate",
      `${queue.skipped.length} signed mandate(s) are out for this cycle (${queue.skipped.map((m) => `${m.id} ${m.chargedThisCycle ? "already charged this cycle" : `only ${m.remaining.toFixed(2)} left`}`).join("; ")}), ${queue.candidates.length} still usable`,
    );
  }

  const rotation = await chargeWithRotation(attempts, amount, baseReference, chargeContext);

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
    const message = result
      ? DECLINE_MESSAGES[code] ?? result.message ?? "The charge was declined"
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

    logAudit(
      state,
      "purchase",
      result
        ? `Declined ${amount} on mandate ${mandateId}: ${code}. ${message} (upstream HTTP ${result.httpStatus}, reference ${reference})`
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

  let reported = false;
  let reportError: string | null = null;

  if (transactionId) {
    try {
      await reportCharge(usedMandateId, transactionId, true, amount);
      reported = true;
    } catch (e) {
      reportError = e instanceof Error ? e.message : String(e);
    }
  } else {
    reportError = "the charge came back without a transaction id, so there was nothing to report";
  }

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
      mandateId: usedMandateId,
      rotatedPast: rotation.rotated.map((r) => r.mandateId),
      status: result.status,
      deduplicated: result.deduplicated,
      reported,
      reportError,
      forced: force,
      reference,
    },
  });
}
