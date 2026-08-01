import { getMandate, listMandates, chargeMandate, reportCharge } from "./prava.ts";
import type { ChargeResult } from "./prava.ts";

export interface MandateView {
  live: boolean;
  id: string | null;
  status: string;
  approvedAmount: string;
  spent: string;
  remaining: string;
  chargeCount: number;
  merchantScope: string;
  validUntil: string;
  recurringFrequency: string;
  unavailableReason: string | null;
}

const FALLBACK_CAP = process.env.MANDATE_CAP ?? "50.00";
const FALLBACK_SCOPE = process.env.RENDER_MERCHANT_URL ?? "https://render.banditd.dev";

function money(n: number): string {
  return n.toFixed(2);
}

export function simulatedMandate(spentSoFar: number, chargeCount: number): MandateView {
  const cap = Number(FALLBACK_CAP);
  return {
    live: false,
    id: null,
    status: "active",
    approvedAmount: money(cap),
    spent: money(spentSoFar),
    remaining: money(Math.max(0, cap - spentSoFar)),
    chargeCount,
    merchantScope: FALLBACK_SCOPE,
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    recurringFrequency: "monthly",
    unavailableReason: "Prava sandbox card enrollment is down (ADDCARD_PROCESSING_ERROR)",
  };
}

type DetailedMandate = Awaited<ReturnType<typeof getMandate>> & {
  spent?: string;
  chargeCount?: number;
};

export async function readMandate(
  mandateId: string | null,
  spentSoFar: number,
  chargeCount: number,
): Promise<MandateView> {
  if (!mandateId) return simulatedMandate(spentSoFar, chargeCount);

  const [detail, listed] = await Promise.allSettled([
    getMandate(mandateId) as Promise<DetailedMandate>,
    listMandates(),
  ]);

  const d = detail.status === "fulfilled" ? detail.value : null;
  const l =
    listed.status === "fulfilled" ? listed.value.find((m) => m.id === mandateId) ?? null : null;

  if (!d && !l) {
    const view = simulatedMandate(spentSoFar, chargeCount);
    view.unavailableReason = "Prava is unreachable right now";
    return view;
  }

  return {
    live: true,
    id: mandateId,
    status: d?.status ?? l?.status ?? "unknown",
    approvedAmount: d?.approvedAmount ?? l?.approvedAmount ?? FALLBACK_CAP,
    spent: d?.spent ?? "0.00",
    remaining: l?.remaining ?? "unknown",
    chargeCount: d?.chargeCount ?? 0,
    merchantScope: l?.merchantScope ?? FALLBACK_SCOPE,
    validUntil: l?.validUntil ?? "unknown",
    recurringFrequency: l?.recurringFrequency ?? "monthly",
    unavailableReason: null,
  };
}

export interface SimulatedCharge {
  ok: boolean;
  simulated: true;
  code: string | null;
  message: string | null;
  transactionId: string;
  cardLast4: string;
}

export function simulateCharge(
  amount: string,
  spentSoFar: number,
  reference: string,
): SimulatedCharge {
  const cap = Number(FALLBACK_CAP);
  const requested = Number(amount);
  const stamp = reference.replace(/\D/g, "").slice(-12) || "000000000000";

  if (requested > cap) {
    return {
      ok: false,
      simulated: true,
      code: "THRESHOLD_EXCEEDED",
      message: `Visa declined: ${amount} exceeds the ${money(cap)} per-charge cap on this mandate`,
      transactionId: `txn_sim_${stamp}`,
      cardLast4: "----",
    };
  }

  return {
    ok: true,
    simulated: true,
    code: null,
    message: null,
    transactionId: `txn_sim_${stamp}`,
    cardLast4: stamp.slice(-4),
  };
}

export async function chargeAndReport(
  mandateId: string,
  amount: string,
  reference: string,
): Promise<{ charge: ChargeResult; reportError: string | null }> {
  const charge = await chargeMandate(mandateId, amount, reference);
  if (!charge.ok) return { charge, reportError: null };

  try {
    await reportCharge(mandateId, charge.transactionId, true, amount);
    return { charge, reportError: null };
  } catch (e) {
    return { charge, reportError: e instanceof Error ? e.message : String(e) };
  }
}
