import { listMandates, chargeMandate } from "./prava.ts";
import type { ChargeContext, ChargeResult, Mandate } from "./prava.ts";

export const NO_MANDATE_AVAILABLE = "NO_MANDATE_AVAILABLE";

export const NO_MANDATE_MESSAGE =
  "Every mandate the seller signed has already been charged in this monthly cycle, so there is nothing left to spend against. Nothing was spent on this attempt. A Prava mandate with a monthly frequency allows one charge per cycle: the seller has to sign another mandate for the agent to keep buying before the cycle renews.";

export const MERCHANT_MANDATE_MISSING = "MERCHANT_MANDATE_MISSING";

export const MERCHANT_MANDATE_MISSING_MESSAGE =
  "The merchant scope demo needs a mandate signed for Allbirds and there is none on the account yet. Nothing was attempted and nothing was spent. Create the session with the setup-merchant script, approve it with the passkey, and the agent will find it by merchant name, or pin it with PRAVA_MERCHANT_DEMO_MANDATE_ID.";

export const DEMO_MERCHANT_NAME = "Allbirds";

interface LastCharge {
  status?: string | null;
  at?: string | null;
}

type ListedMandate = Mandate & { lastCharge?: LastCharge | null };

export interface MandateCandidate {
  id: string;
  approvedAmount: number;
  remaining: number;
  reserved: boolean;
  chargedThisCycle: boolean;
  lastChargeStatus: string | null;
  lastChargeAt: string | null;
}

function toAmount(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function reservedAmount(): number {
  return toAmount(process.env.PRAVA_REJECTION_MANDATE_AMOUNT ?? "5.00", 5);
}

function isReserved(m: ListedMandate): boolean {
  const pinned = process.env.PRAVA_REJECTION_MANDATE_ID;
  if (pinned) return m.id === pinned;
  return toAmount(m.approvedAmount, 0) === reservedAmount();
}

function chargedThisCycle(m: ListedMandate): boolean {
  const approved = toAmount(m.approvedAmount, 0);
  const remaining = toAmount(m.remaining, approved);
  if (approved > 0 && remaining < approved) return true;
  return m.lastCharge?.status === "completed";
}

function usable(m: ListedMandate): boolean {
  return m.status === "active" && m.state !== "consumed" && m.state !== "expired";
}

function toCandidate(m: ListedMandate): MandateCandidate {
  const approved = toAmount(m.approvedAmount, 0);
  return {
    id: m.id,
    approvedAmount: approved,
    remaining: toAmount(m.remaining, approved),
    reserved: isReserved(m),
    chargedThisCycle: chargedThisCycle(m),
    lastChargeStatus: m.lastCharge?.status ?? null,
    lastChargeAt: m.lastCharge?.at ?? null,
  };
}

function unknownCandidate(id: string): MandateCandidate {
  return {
    id,
    approvedAmount: 0,
    remaining: 0,
    reserved: false,
    chargedThisCycle: false,
    lastChargeStatus: null,
    lastChargeAt: null,
  };
}

export interface MandateQueue {
  all: MandateCandidate[];
  candidates: MandateCandidate[];
  skipped: MandateCandidate[];
  reserved: MandateCandidate | null;
  listError: string | null;
}

export async function mandateQueue(
  amount: number,
  preferredId: string | null,
  customerId?: string,
): Promise<MandateQueue> {
  let listed: ListedMandate[];
  try {
    listed = (await listMandates(customerId)) as ListedMandate[];
  } catch (e) {
    return {
      all: preferredId ? [unknownCandidate(preferredId)] : [],
      candidates: preferredId ? [unknownCandidate(preferredId)] : [],
      skipped: [],
      reserved: null,
      listError: e instanceof Error ? e.message : String(e),
    };
  }

  const all = listed.filter(usable).map(toCandidate);
  const reserved = all.find((c) => c.reserved) ?? null;
  const pool = all.filter((c) => !c.reserved);
  const candidates = pool.filter((c) => !c.chargedThisCycle && c.remaining >= amount);
  const skipped = pool.filter((c) => c.chargedThisCycle || c.remaining < amount);

  candidates.sort((a, b) => {
    if (a.id === preferredId) return -1;
    if (b.id === preferredId) return 1;
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    return a.id < b.id ? -1 : 1;
  });

  if (!candidates.length && preferredId && !all.length) {
    candidates.push(unknownCandidate(preferredId));
  }

  return { all, candidates, skipped, reserved, listError: null };
}

export function exhaustionMessage(queue: MandateQueue, amount: string): string {
  const cycled = queue.skipped.filter((m) => m.chargedThisCycle).length;
  const short = queue.skipped.filter((m) => !m.chargedThisCycle).length;

  if (short && !cycled) {
    return `No signed mandate has ${amount} USD left to charge, the largest one left is smaller than the amount the agent asked for. Nothing was spent. The agent has to buy a cheaper bundle, or the seller has to sign a wider mandate.`;
  }
  if (short && cycled) {
    return `${cycled} signed mandate(s) were already charged in this monthly cycle and ${short} do not have ${amount} USD left, so there is nothing to charge. Nothing was spent. A Prava mandate with a monthly frequency allows one charge per cycle: the seller has to sign another mandate for the agent to keep buying.`;
  }
  return NO_MANDATE_MESSAGE;
}

export function rejectionTarget(queue: MandateQueue, preferredId: string | null): MandateCandidate | null {
  if (queue.reserved) return queue.reserved;
  if (queue.candidates.length) return queue.candidates[0];
  const live = queue.all.find((c) => !c.chargedThisCycle) ?? queue.all[0];
  if (live) return live;
  return preferredId ? unknownCandidate(preferredId) : null;
}

export function overCapAmount(target: MandateCandidate | null): string {
  const cap = target && target.approvedAmount > 0
    ? target.approvedAmount
    : toAmount(process.env.MANDATE_CAP ?? "50.00", 50);
  return (cap * 10).toFixed(2);
}

export async function merchantDemoTarget(customerId?: string): Promise<MandateCandidate | null> {
  const pinned = process.env.PRAVA_MERCHANT_DEMO_MANDATE_ID;
  let listed: ListedMandate[];
  try {
    listed = (await listMandates(customerId)) as ListedMandate[];
  } catch {
    return pinned ? unknownCandidate(pinned) : null;
  }

  const match = listed
    .filter(usable)
    .find((m) =>
      pinned
        ? m.id === pinned
        : (m.merchantName ?? "").toLowerCase().includes(DEMO_MERCHANT_NAME.toLowerCase()),
    );

  if (match) return toCandidate(match);
  return pinned ? unknownCandidate(pinned) : null;
}

export function scopeDemoAmount(target: MandateCandidate): string {
  const fallback = toAmount(process.env.RENDER_CREDIT_PRICE ?? "4.00", 4);
  if (target.approvedAmount <= 0) return fallback.toFixed(2);
  return Math.min(fallback, target.approvedAmount).toFixed(2);
}

export function renderCreditsContext(amount: string): ChargeContext {
  return {
    merchantName: process.env.RENDER_MERCHANT_NAME ?? "Banditd Render Credits",
    merchantUrl: process.env.RENDER_MERCHANT_URL ?? "https://banditd.vercel.app",
    merchantCountry: process.env.RENDER_MERCHANT_COUNTRY ?? "US",
    productDescription: "Ad creative render credits",
    unitPrice: amount,
  };
}

export interface RotationAttempt {
  mandateId: string;
  code: string;
  message: string;
  reference: string;
}

export interface RotationResult {
  charge: ChargeResult | null;
  mandateId: string | null;
  reference: string | null;
  rotated: RotationAttempt[];
}

export async function chargeWithRotation(
  candidates: MandateCandidate[],
  amount: string,
  reference: string,
  context?: ChargeContext,
): Promise<RotationResult> {
  const rotated: RotationAttempt[] = [];

  for (const candidate of candidates) {
    const attemptReference =
      candidates.length > 1 ? `${reference}_${candidate.id.slice(-6)}` : reference;
    const charge = await chargeMandate(candidate.id, amount, attemptReference, context);

    if (charge.ok || charge.code !== "CYCLE_ALREADY_CHARGED") {
      return { charge, mandateId: candidate.id, reference: attemptReference, rotated };
    }

    rotated.push({
      mandateId: candidate.id,
      code: charge.code,
      message: charge.message,
      reference: attemptReference,
    });
  }

  return { charge: null, mandateId: null, reference: null, rotated };
}
