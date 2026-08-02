import type { Arm } from "./bandit.ts";

export interface Product {
  name: string;
  price: string;
  description: string;
  marketContext?: string;
  variant?: string;
  brand?: string;
}

export interface PriceRange {
  low: string;
  high: string;
  recommended: string;
  why: string;
}

export interface ProductOptions {
  variants: string[];
  brands: string[];
  priceRange: PriceRange | null;
}

export const MAX_MARKET_CONTEXT = 500;
export const MAX_MARKET_LINKS = 4;
export const MAX_REFINEMENT = 60;
export const MAX_OPTIONS = 6;
export const MAX_PRICE_LABEL = 16;
export const MAX_PRICE_REASON = 180;

function scrub(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function sanitizeRefinement(value: unknown): string {
  return scrub(value, MAX_REFINEMENT);
}

export function sanitizePriceRange(value: unknown): PriceRange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const low = scrub(raw.low, MAX_PRICE_LABEL);
  const high = scrub(raw.high, MAX_PRICE_LABEL);
  const recommended = scrub(raw.recommended, MAX_PRICE_LABEL);
  if (!low || !high || !recommended) return null;
  return { low, high, recommended, why: scrub(raw.why, MAX_PRICE_REASON) };
}

export function sanitizeOptionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const item of value) {
    const clean = sanitizeRefinement(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(clean);
    if (kept.length >= MAX_OPTIONS) break;
  }
  return kept;
}

export function sanitizeMarketContext(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MARKET_CONTEXT);
}

export function marketLinks(context: string): string[] {
  const found: string[] = [];
  for (const match of context.matchAll(/https?:\/\/[^\s"'`)\]]+/gi)) {
    const raw = match[0].replace(/[.,;:!?)\]]+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (!parsed.hostname.includes(".")) continue;
    const href = parsed.toString();
    if (found.includes(href)) continue;
    found.push(href);
    if (found.length >= MAX_MARKET_LINKS) break;
  }
  return found;
}

export interface Research {
  buyerProfile: string;
  competitorAngles: string[];
  pricePositioning: string;
  sources: { title: string; url: string }[];
}

export interface CompetitorPlay {
  play: string;
  why: string;
}

export interface NextTest {
  idea: string;
  why: string;
}

export interface ProductEstimate {
  label: string;
  call: string;
  basis: string;
}

export interface Insights {
  at: string;
  generation: number;
  impressions: number;
  winnerAngle: string;
  winnerHeadline: string;
  buyerLesson: string;
  competitorPlays: CompetitorPlay[];
  nextTests: NextTest[];
  estimates: ProductEstimate[];
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
  productOptions: ProductOptions | null;
  research: Research | null;
  insights: Insights | null;
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
    productOptions: null,
    research: null,
    insights: null,
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
  return {
    name: p.name,
    price: text(p.price),
    description: text(p.description),
    marketContext: sanitizeMarketContext(p.marketContext),
    variant: sanitizeRefinement(p.variant),
    brand: sanitizeRefinement(p.brand),
  };
}

function coerceProductOptions(value: unknown): ProductOptions | null {
  const o = record(value);
  if (!o) return null;
  return {
    variants: sanitizeOptionList(o.variants),
    brands: sanitizeOptionList(o.brands),
    priceRange: sanitizePriceRange(o.priceRange),
  };
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

function pairs(value: unknown): Record<string, unknown>[] {
  return list(value)
    .map((item) => record(item))
    .filter((item): item is Record<string, unknown> => item !== null);
}

function coerceInsights(value: unknown): Insights | null {
  const i = record(value);
  if (!i) return null;
  return {
    at: text(i.at),
    generation: Math.max(0, Math.floor(count(i.generation))),
    impressions: Math.max(0, Math.floor(count(i.impressions))),
    winnerAngle: text(i.winnerAngle),
    winnerHeadline: text(i.winnerHeadline),
    buyerLesson: text(i.buyerLesson),
    competitorPlays: pairs(i.competitorPlays)
      .map((p) => ({ play: text(p.play), why: text(p.why) }))
      .filter((p) => p.play.length > 0),
    nextTests: pairs(i.nextTests)
      .map((t) => ({ idea: text(t.idea), why: text(t.why) }))
      .filter((t) => t.idea.length > 0),
    estimates: pairs(i.estimates)
      .map((e) => ({ label: text(e.label), call: text(e.call), basis: text(e.basis) }))
      .filter((e) => e.label.length > 0),
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

export function ledgerBalance(entries: CreditEntry[]): number {
  return Math.max(0, entries.reduce((sum, e) => sum + e.amount, 0));
}

function coerceCredits(value: unknown): Credits {
  const c = record(value);
  if (!c) return starterCredits();
  const entries = list(c.entries)
    .map(coerceCreditEntry)
    .filter((e): e is CreditEntry => e !== null)
    .slice(0, MAX_AUDIT);
  return { balance: ledgerBalance(entries), entries };
}

export function coerceState(value: unknown): State | null {
  const raw = record(value);
  if (!raw) return null;

  return {
    product: coerceProduct(raw.product),
    productOptions: coerceProductOptions(raw.productOptions),
    research: coerceResearch(raw.research),
    insights: coerceInsights(raw.insights),
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
