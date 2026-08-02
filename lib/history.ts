import type { CreativeAngle } from "./state-schema.ts";

export const HISTORY_KEY = "banditd_history";
export const MAX_HISTORY = 12;
export const MAX_ARCHIVED_ADS = 8;

const ANGLES: CreativeAngle[] = ["price", "ritual", "gift", "quality"];

export interface ArchivedAd {
  id: string;
  angle: CreativeAngle;
  headline: string;
  impressions: number;
  clicks: number;
}

export interface ArchivedWinner {
  id: string;
  angle: CreativeAngle;
  headline: string;
  probabilityBest: number;
}

export interface ArchivedRun {
  id: string;
  at: string;
  product: { name: string; price: string; description: string };
  generation: number;
  impressions: number;
  ads: ArchivedAd[];
  winner: ArchivedWinner | null;
  spent: number;
  charges: number;
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

function whole(value: unknown): number {
  return Math.max(0, Math.floor(count(value)));
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function angleOf(value: unknown): CreativeAngle {
  return ANGLES.includes(value as CreativeAngle) ? (value as CreativeAngle) : "quality";
}

function amountOf(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function adCtr(ad: { impressions: number; clicks: number }): number {
  if (!ad.impressions) return 0;
  return ad.clicks / ad.impressions;
}

export function winnerCtr(run: ArchivedRun): number {
  const ad = run.winner ? run.ads.find((a) => a.id === run.winner?.id) : null;
  return ad ? adCtr(ad) : 0;
}

export function runnerUpCtr(run: ArchivedRun): number {
  const rest = run.ads.filter((a) => a.id !== run.winner?.id).map(adCtr);
  return rest.length ? Math.max(...rest) : 0;
}

function runId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeAd(value: unknown): ArchivedAd | null {
  const c = record(value);
  if (!c || typeof c.id !== "string") return null;
  const impressions = whole(c.impressions);
  return {
    id: c.id,
    angle: angleOf(c.angle),
    headline: text(c.headline),
    impressions,
    clicks: Math.min(whole(c.clicks), impressions),
  };
}

function safeWinner(value: unknown, ads: ArchivedAd[]): ArchivedWinner | null {
  const w = record(value);
  if (!w || typeof w.id !== "string") return null;
  const known = ads.find((a) => a.id === w.id);
  return {
    id: w.id,
    angle: angleOf(w.angle ?? known?.angle),
    headline: text(w.headline, known?.headline ?? ""),
    probabilityBest: Math.max(0, Math.min(1, count(w.probabilityBest))),
  };
}

export function coerceRun(value: unknown): ArchivedRun | null {
  const r = record(value);
  if (!r || typeof r.id !== "string") return null;
  const product = record(r.product);
  if (!product || typeof product.name !== "string") return null;
  const ads = list(r.ads)
    .map(safeAd)
    .filter((a): a is ArchivedAd => a !== null)
    .slice(0, MAX_ARCHIVED_ADS);
  return {
    id: r.id,
    at: text(r.at),
    product: {
      name: product.name,
      price: text(product.price),
      description: text(product.description),
    },
    generation: whole(r.generation),
    impressions: whole(r.impressions),
    ads,
    winner: safeWinner(r.winner, ads),
    spent: Math.max(0, count(r.spent)),
    charges: whole(r.charges),
  };
}

export function summarizeRun(value: unknown): ArchivedRun | null {
  const state = record(value);
  if (!state) return null;
  const product = record(state.product);
  if (!product || typeof product.name !== "string") return null;

  const creatives = list(state.creatives)
    .map((c) => record(c))
    .filter((c): c is Record<string, unknown> => c !== null && typeof c.id === "string");

  const generation = creatives.length ? Math.max(...creatives.map((c) => whole(c.generation))) : 0;

  const ads = creatives
    .filter((c) => whole(c.generation) === generation)
    .map((c) => {
      const arm = record(c.arm);
      const impressions = whole(arm?.impressions);
      return {
        id: String(c.id),
        angle: angleOf(c.angle),
        headline: text(c.headline),
        impressions,
        clicks: Math.min(whole(arm?.clicks), impressions),
      };
    })
    .slice(0, MAX_ARCHIVED_ADS);

  const purchases = list(state.purchases)
    .map((p) => record(p))
    .filter((p): p is Record<string, unknown> => p !== null);
  const paid = purchases.filter((p) => p.ok === true);
  const spent = paid.reduce((sum, p) => sum + amountOf(p.amount), 0);

  if (ads.length === 0 && purchases.length === 0) return null;

  const called = paid.find((p) => ads.some((a) => a.id === text(p.winnerId)));
  const leader = ads
    .filter((a) => a.impressions > 0)
    .reduce<ArchivedAd | null>((best, a) => (!best || adCtr(a) > adCtr(best) ? a : best), null);
  const head = called ? (ads.find((a) => a.id === text(called.winnerId)) ?? null) : leader;

  const winner: ArchivedWinner | null = head
    ? {
        id: head.id,
        angle: head.angle,
        headline: head.headline,
        probabilityBest:
          called && text(called.winnerId) === head.id
            ? Math.max(0, Math.min(1, count(called.probabilityBest)))
            : 0,
      }
    : null;

  return {
    id: runId(),
    at: new Date().toISOString(),
    product: {
      name: product.name,
      price: text(product.price),
      description: text(product.description),
    },
    generation,
    impressions: ads.reduce((sum, a) => sum + a.impressions, 0),
    ads,
    winner,
    spent,
    charges: paid.length,
  };
}

export function readHistory(): ArchivedRun[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(HISTORY_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    return list(JSON.parse(raw) as unknown)
      .map(coerceRun)
      .filter((r): r is ArchivedRun => r !== null)
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

const NO_RUNS: ArchivedRun[] = [];

let cachedRaw: string | null = null;
let cachedRuns: ArchivedRun[] = NO_RUNS;

function currentRaw(): string | null {
  try {
    return window.localStorage.getItem(HISTORY_KEY);
  } catch {
    return null;
  }
}

export function subscribeHistory(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

export function historySnapshot(): ArchivedRun[] {
  const raw = currentRaw();
  if (raw === cachedRaw) return cachedRuns;
  cachedRaw = raw;
  cachedRuns = readHistory();
  return cachedRuns;
}

export function serverHistory(): ArchivedRun[] {
  return NO_RUNS;
}

export function writeHistory(runs: ArchivedRun[]): ArchivedRun[] {
  let kept = runs.slice(0, MAX_HISTORY);
  while (kept.length > 0) {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(kept));
      return kept;
    } catch {
      kept = kept.slice(0, kept.length - 1);
    }
  }
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    return [];
  }
  return [];
}

export function archiveRun(stored: string | null): ArchivedRun | null {
  if (!stored) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  const run = summarizeRun(parsed);
  if (!run) return null;
  const kept = writeHistory([run, ...readHistory()]);
  return kept.some((r) => r.id === run.id) ? run : null;
}
