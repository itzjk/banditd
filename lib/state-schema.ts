import type { Arm } from "./bandit.ts";

export interface Product {
  name: string;
  price: string;
  description: string;
}

export interface Research {
  buyerProfile: string;
  competitorAngles: string[];
  pricePositioning: string;
  sources: { title: string; url: string }[];
}

export type CreativeAngle = "price" | "ritual" | "gift" | "quality";

export interface Creative {
  id: string;
  generation: number;
  parentId: string | null;
  angle: CreativeAngle;
  headline: string;
  body: string;
  imagePrompt: string;
  targetEmotion: string;
  imageData: string | null;
  arm: Arm;
}

export interface PurchaseEvent {
  id: string;
  at: string;
  amount: string;
  reason: string;
  winnerId: string;
  probabilityBest: number;
  impressions: number;
  ok: boolean;
  errorCode: string | null;
  cardLast4: string | null;
  transactionId: string | null;
  mandateId: string | null;
}

export interface AuditEntry {
  at: string;
  kind: string;
  detail: string;
}

export type CreditKind = "purchase" | "render" | "grant";

export interface CreditEntry {
  at: string;
  kind: CreditKind;
  amount: number;
  ref: string;
}

export interface Credits {
  balance: number;
  entries: CreditEntry[];
}

export interface RoundArm {
  id: string;
  impressions: number;
  clicks: number;
}

export interface Round {
  at: string;
  generation: number;
  served: number;
  arms: RoundArm[];
}

export interface State {
  product: Product | null;
  research: Research | null;
  creatives: Creative[];
  purchases: PurchaseEvent[];
  audit: AuditEntry[];
  rounds: Round[];
  credits: Credits;
  mandateId: string | null;
  simulatedImpressions: number;
}

export interface Session {
  state: State;
  detached: boolean;
}

const ANGLES: CreativeAngle[] = ["price", "ritual", "gift", "quality"];
const CREDIT_KINDS: CreditKind[] = ["purchase", "render", "grant"];
export const MAX_AUDIT = 200;
export const MAX_ROUNDS = 200;
export const STARTER_CREDITS = 4;

export function starterCredits(): Credits {
  return {
    balance: STARTER_CREDITS,
    entries: [
      {
        at: new Date().toISOString(),
        kind: "grant",
        amount: STARTER_CREDITS,
        ref: "starter_grant",
      },
    ],
  };
}

export function emptyState(): State {
  return {
    product: null,
    research: null,
    creatives: [],
    purchases: [],
    audit: [],
    rounds: [],
    credits: starterCredits(),
    mandateId: process.env.PRAVA_MANDATE_ID ?? null,
    simulatedImpressions: 0,
  };
}


function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function coerceProduct(value: unknown): Product | null {
  const p = record(value);
  if (!p || typeof p.name !== "string") return null;
  return { name: p.name, price: text(p.price), description: text(p.description) };
}

function coerceResearch(value: unknown): Research | null {
  const r = record(value);
  if (!r) return null;
  return {
    buyerProfile: text(r.buyerProfile),
    competitorAngles: list(r.competitorAngles).map((a) => text(a)),
    pricePositioning: text(r.pricePositioning),
    sources: list(r.sources)
      .map((s) => record(s))
      .filter((s): s is Record<string, unknown> => s !== null)
      .map((s) => ({ title: text(s.title), url: text(s.url) })),
  };
}

function coerceCreative(value: unknown): Creative | null {
  const c = record(value);
  if (!c || typeof c.id !== "string") return null;
  const arm = record(c.arm);
  const angle = ANGLES.includes(c.angle as CreativeAngle) ? (c.angle as CreativeAngle) : "quality";
  return {
    id: c.id,
    generation: count(c.generation),
    parentId: typeof c.parentId === "string" ? c.parentId : null,
    angle,
    headline: text(c.headline),
    body: text(c.body),
    imagePrompt: text(c.imagePrompt),
    targetEmotion: text(c.targetEmotion),
    imageData: typeof c.imageData === "string" ? c.imageData : null,
    arm: coerceArm(arm),
  };
}

function coerceArm(raw: Record<string, unknown> | null): Arm {
  const impressions = Math.max(0, Math.floor(count(raw?.impressions)));
  const clicks = Math.max(0, Math.floor(count(raw?.clicks)));
  return { impressions, clicks: Math.min(clicks, impressions) };
}

function coercePurchase(value: unknown): PurchaseEvent | null {
  const p = record(value);
  if (!p || typeof p.id !== "string") return null;
  return {
    id: p.id,
    at: text(p.at),
    amount: text(p.amount),
    reason: text(p.reason),
    winnerId: text(p.winnerId),
    probabilityBest: count(p.probabilityBest),
    impressions: count(p.impressions),
    ok: p.ok === true,
    errorCode: typeof p.errorCode === "string" ? p.errorCode : null,
    cardLast4: typeof p.cardLast4 === "string" ? p.cardLast4 : null,
    transactionId: typeof p.transactionId === "string" ? p.transactionId : null,
    mandateId: typeof p.mandateId === "string" ? p.mandateId : null,
  };
}

function coerceAudit(value: unknown): AuditEntry | null {
  const a = record(value);
  if (!a) return null;
  return { at: text(a.at), kind: text(a.kind), detail: text(a.detail) };
}

function coerceRoundArm(value: unknown): RoundArm | null {
  const a = record(value);
  if (!a || typeof a.id !== "string") return null;
  const impressions = Math.max(0, Math.floor(count(a.impressions)));
  const clicks = Math.max(0, Math.floor(count(a.clicks)));
  return { id: a.id, impressions, clicks: Math.min(clicks, impressions) };
}

function coerceRound(value: unknown): Round | null {
  const r = record(value);
  if (!r) return null;
  const arms = list(r.arms)
    .map(coerceRoundArm)
    .filter((a): a is RoundArm => a !== null);
  if (arms.length === 0) return null;
  return {
    at: text(r.at),
    generation: Math.max(0, Math.floor(count(r.generation))),
    served: Math.max(0, Math.floor(count(r.served))),
    arms,
  };
}

function coerceCreditEntry(value: unknown): CreditEntry | null {
  const e = record(value);
  if (!e || !CREDIT_KINDS.includes(e.kind as CreditKind)) return null;
  const amount = Math.trunc(count(e.amount));
  if (amount === 0) return null;
  return { at: text(e.at), kind: e.kind as CreditKind, amount, ref: text(e.ref) };
}

function coerceCredits(value: unknown): Credits {
  const c = record(value);
  if (!c) return starterCredits();
  return {
    balance: Math.max(0, Math.trunc(count(c.balance))),
    entries: list(c.entries)
      .map(coerceCreditEntry)
      .filter((e): e is CreditEntry => e !== null)
      .slice(0, MAX_AUDIT),
  };
}

export function coerceState(value: unknown): State | null {
  const raw = record(value);
  if (!raw) return null;

  return {
    product: coerceProduct(raw.product),
    research: coerceResearch(raw.research),
    creatives: list(raw.creatives)
      .map(coerceCreative)
      .filter((c): c is Creative => c !== null),
    purchases: list(raw.purchases)
      .map(coercePurchase)
      .filter((p): p is PurchaseEvent => p !== null),
    audit: list(raw.audit)
      .map(coerceAudit)
      .filter((a): a is AuditEntry => a !== null)
      .slice(0, MAX_AUDIT),
    rounds: list(raw.rounds)
      .map(coerceRound)
      .filter((r): r is Round => r !== null)
      .slice(-MAX_ROUNDS),
    credits: coerceCredits(raw.credits),
    mandateId: typeof raw.mandateId === "string" ? raw.mandateId : null,
    simulatedImpressions: count(raw.simulatedImpressions),
  };
}
