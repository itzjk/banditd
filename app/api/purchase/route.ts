import { NextResponse } from "next/server";
import { openSession, commit, logAudit } from "@/lib/store";
import { chargeMandate, reportCharge } from "@/lib/prava";
import type { PurchaseEvent } from "@/lib/store";

export const maxDuration = 60;

interface PurchaseBody {
  amount?: string;
  reason?: string;
  winnerId?: string;
  probabilityBest?: number;
  impressions?: number;
  force?: boolean;
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
};

function mandateCap(): number {
  const cap = Number(process.env.MANDATE_CAP ?? "50.00");
  return Number.isFinite(cap) && cap > 0 ? cap : 50;
}

function overCapAmount(): string {
  return (mandateCap() * 10).toFixed(2);
}

function normalizeAmount(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PurchaseBody;

  const session = openSession(body.state);
  const state = session.state;
  if (!state.mandateId) {
    return NextResponse.json(
      {
        error:
          "no mandate on file, so the agent has nothing to charge. The seller has to sign the mandate first: create the session, approve it with the passkey, then set PRAVA_MANDATE_ID or store the mandate id on the state.",
      },
      { status: 400 },
    );
  }

  const mandateId = state.mandateId;
  const force = body.force === true;
  const requested = normalizeAmount(body.amount);

  if (!force && !requested) {
    return NextResponse.json(
      { error: "amount is required and has to be a positive decimal string, for example \"12.00\"" },
      { status: 400 },
    );
  }

  const amount = force ? overCapAmount() : requested!;
  const winnerId = body.winnerId?.trim() || "unknown_creative";
  const reason =
    body.reason?.trim() ||
    (force
      ? `Deliberate over-cap charge of ${amount} to prove the mandate ceiling holds`
      : "Bandit called the winner and bought more render credits");
  const probabilityBest = toNumber(body.probabilityBest);
  const impressions = toNumber(body.impressions);
  const reference = `banditd_${Date.now()}_${winnerId}`;

  if (force) {
    logAudit(
      state,
      "purchase",
      `Forcing a ${amount} charge against a ${mandateCap().toFixed(2)} per-charge cap to show the guardrail rejecting the agent`,
    );
  }

  const result = await chargeMandate(mandateId, amount, reference);

  if (!result.ok) {
    const message = DECLINE_MESSAGES[result.code] ?? result.message ?? "The charge was declined";

    const event: PurchaseEvent = {
      id: `pu_${Date.now()}`,
      at: new Date().toISOString(),
      amount,
      reason,
      winnerId,
      probabilityBest,
      impressions,
      ok: false,
      errorCode: result.code,
      cardLast4: null,
      transactionId: result.transactionId ?? null,
    };

    state.purchases.unshift(event);

    logAudit(
      state,
      "purchase",
      `Declined ${amount} on mandate ${mandateId}: ${result.code}. ${message} (upstream HTTP ${result.httpStatus}, reference ${reference})`,
    );

    return NextResponse.json({
      ...commit(session),
      lastPurchase: {
        ok: false,
        amount,
        reason,
        winnerId,
        errorCode: result.code,
        message,
        upstreamMessage: result.message,
        upstreamStatus: result.httpStatus,
        forced: force,
        reference,
      },
    });
  }

  const token = result.credentials.token ?? "";
  const cardLast4 = token.length >= 4 ? token.slice(-4) : null;
  const transactionId = result.transactionId || null;

  let reported = false;
  let reportError: string | null = null;

  if (transactionId) {
    try {
      await reportCharge(mandateId, transactionId, true, amount);
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
  };

  state.purchases.unshift(event);

  logAudit(
    state,
    "purchase",
    `Charged ${amount} on mandate ${mandateId} for "${reason}" on card ending ${cardLast4 ?? "????"}${result.deduplicated ? ", deduplicated by reference" : ""} (txn ${transactionId ?? "n/a"}, reference ${reference})`,
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
      status: result.status,
      deduplicated: result.deduplicated,
      reported,
      reportError,
      forced: force,
      reference,
    },
  });
}
