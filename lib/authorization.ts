import { listMandates } from "./prava.ts";
import type { Mandate } from "./prava.ts";

export const RENDER_MERCHANT = process.env.RENDER_MERCHANT_NAME ?? "Banditd Render Credits";

export interface SignedMandate {
  id: string;
  merchant: string | null;
  ceiling: number | null;
  remaining: number | null;
  expiry: string | null;
  expiryIso: string | null;
  frequency: string | null;
  scope: string | null;
  maxCharges: number | null;
  status: string;
  chargeUsedThisCycle: boolean;
}

export interface Authorization {
  live: boolean;
  error: string | null;
  inForce: SignedMandate | null;
  queued: SignedMandate[];
  spent: SignedMandate[];
  elsewhere: SignedMandate[];
}

export interface MandateFactsRead {
  live: boolean;
  error: string | null;
  mandate: SignedMandate | null;
  queued: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.round((date.getTime() - Date.now()) / 86400000);
}

function amount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isRenderMerchant(name: string | null): boolean {
  if (!name) return false;
  return name.trim().toLowerCase() === RENDER_MERCHANT.trim().toLowerCase();
}

function isReserved(m: Mandate): boolean {
  const pinned = process.env.PRAVA_REJECTION_MANDATE_ID;
  if (pinned) return m.id === pinned;
  const reserved = amount(process.env.PRAVA_REJECTION_MANDATE_AMOUNT ?? "5.00") ?? 5;
  return amount(m.approvedAmount) === reserved;
}

function usable(m: Mandate): boolean {
  return m.status === "active" && m.state !== "consumed" && m.state !== "expired";
}

function toSigned(m: Mandate): SignedMandate {
  const ceiling = amount(m.approvedAmount);
  const remaining = amount(m.remaining) ?? ceiling;
  return {
    id: m.id,
    merchant: m.merchantName ?? null,
    ceiling,
    remaining,
    expiry: formatDay(m.validUntil),
    expiryIso: m.validUntil ?? null,
    frequency: m.recurringFrequency ?? null,
    scope: m.merchantScope ?? null,
    maxCharges: typeof m.maxCharges === "number" ? m.maxCharges : null,
    status: m.status,
    chargeUsedThisCycle: ceiling !== null && remaining !== null && remaining < ceiling,
  };
}

function newestFirst(a: SignedMandate, b: SignedMandate): number {
  const left = a.expiryIso ? Date.parse(a.expiryIso) : 0;
  const right = b.expiryIso ? Date.parse(b.expiryIso) : 0;
  return right - left;
}

export async function readAuthorization(): Promise<Authorization> {
  let listed: Mandate[];
  try {
    listed = await listMandates(process.env.PRAVA_USER_ID);
  } catch (e) {
    return {
      live: false,
      error: e instanceof Error ? e.message : String(e),
      inForce: null,
      queued: [],
      spent: [],
      elsewhere: [],
    };
  }

  const active = listed.filter(usable).filter((m) => !isReserved(m)).map(toSigned);
  const ours = active.filter((m) => isRenderMerchant(m.merchant) || m.merchant === null);
  const elsewhere = active.filter((m) => m.merchant !== null && !isRenderMerchant(m.merchant));
  const ready = ours.filter((m) => !m.chargeUsedThisCycle).sort(newestFirst);
  const spent = ours.filter((m) => m.chargeUsedThisCycle).sort(newestFirst);

  return {
    live: true,
    error: null,
    inForce: ready[0] ?? spent[0] ?? null,
    queued: ready.slice(1),
    spent,
    elsewhere: elsewhere.sort(newestFirst),
  };
}

export async function readMandateFacts(id: string | null): Promise<MandateFactsRead> {
  const read = await readAuthorization();
  if (!read.live) return { live: false, error: read.error, mandate: null, queued: 0 };

  const pool = [read.inForce, ...read.queued, ...read.spent, ...read.elsewhere].filter(
    (m): m is SignedMandate => m !== null,
  );
  const match = (id ? pool.find((m) => m.id === id) : null) ?? read.inForce ?? null;

  return { live: true, error: null, mandate: match, queued: read.queued.length };
}
