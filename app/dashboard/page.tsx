"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import Link from "next/link";
import type {
  AuditEntry,
  Creative,
  CreativeAngle,
  CreditEntry,
  CreditKind,
  Credits,
  Insights as InsightsData,
  PriceRange,
  Product,
  ProductOptions,
  PurchaseEvent,
  Research,
  Round,
  RoundArm,
  State,
} from "@/lib/store";
import MandateBar from "@/components/MandateBar";
import CreativeCard from "@/components/CreativeCard";
import RunExport from "@/components/RunExport";
import { PurchaseLedger } from "@/components/PurchaseEvent";
import AuditLog from "@/components/AuditLog";
import AgentStatus from "@/components/AgentStatus";
import PosteriorChart from "@/components/PosteriorChart";
import CampaignMetrics from "@/components/CampaignMetrics";
import AgentReadout from "@/components/AgentReadout";
import PerformanceChart from "@/components/PerformanceChart";
import GatesPanel from "@/components/GatesPanel";
import LineageTree from "@/components/LineageTree";
import MarketPanel from "@/components/MarketPanel";
import ProductBar from "@/components/ProductBar";
import Insights from "@/components/Insights";
import ProofLab from "@/components/ProofLab";
import AgentChat from "@/components/AgentChat";
import Reveal from "@/components/visuals/Reveal";
import DemoRunner, { AGENT_STEPS, EVIDENCE_TARGET } from "@/components/DemoRunner";
import type { Decision, Evaluation, LastPurchase, Task } from "@/components/DemoRunner";
import { ctr, money, pct, plain, strength } from "@/components/format";
import { declineFamily } from "@/lib/declines";
import RunHistory from "@/components/RunHistory";
import { archiveRun, historySnapshot, serverHistory, subscribeHistory } from "@/lib/history";

const MANDATE_CAP = 50;
const STORAGE_KEY = "banditd_state";
const IMAGES_KEY = "banditd_images";
const REV_KEY = "banditd_rev";
const ANGLES: CreativeAngle[] = ["price", "ritual", "gift", "quality"];
const CREDIT_KINDS: CreditKind[] = ["purchase", "render", "grant"];
const MAX_AUDIT = 200;
const MAX_ROUNDS = 200;
const MAX_MARKET_CONTEXT = 500;
const MAX_REFINEMENT = 60;
const MAX_OPTIONS = 6;
const MAX_PRICE_LABEL = 16;
const MAX_PRICE_REASON = 180;
const STARTER_CREDITS = 4;

const UNREADABLE =
  "A saved session in this browser could not be read, so it was discarded. You are starting clean.";
const PATCHED =
  "A saved session in this browser had damaged entries. They were dropped and the rest was restored.";
const ADOPTED =
  "Another tab of this dashboard moved the run forward, so this tab picked up its state. Nothing was overwritten.";

type Images = Record<string, string>;

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

function safeRefinement(value: unknown): string {
  return text(value).trim().slice(0, MAX_REFINEMENT);
}

function safeProduct(value: unknown): Product | null {
  const p = record(value);
  if (!p || typeof p.name !== "string") return null;
  return {
    name: p.name,
    price: text(p.price),
    description: text(p.description),
    marketContext: text(p.marketContext).slice(0, MAX_MARKET_CONTEXT),
    variant: safeRefinement(p.variant),
    brand: safeRefinement(p.brand),
  };
}

function safeOptionList(value: unknown): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const item of list(value)) {
    const clean = safeRefinement(item);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(clean);
    if (kept.length >= MAX_OPTIONS) break;
  }
  return kept;
}

function safePriceRange(value: unknown): PriceRange | null {
  const p = record(value);
  if (!p) return null;
  const low = text(p.low).trim().slice(0, MAX_PRICE_LABEL);
  const high = text(p.high).trim().slice(0, MAX_PRICE_LABEL);
  const recommended = text(p.recommended).trim().slice(0, MAX_PRICE_LABEL);
  if (!low || !high || !recommended) return null;
  return { low, high, recommended, why: text(p.why).trim().slice(0, MAX_PRICE_REASON) };
}

function safeOptions(value: unknown): ProductOptions | null {
  const o = record(value);
  if (!o) return null;
  return {
    variants: safeOptionList(o.variants),
    brands: safeOptionList(o.brands),
    priceRange: safePriceRange(o.priceRange),
  };
}

function safeResearch(value: unknown): Research | null {
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

function safeInsights(value: unknown): InsightsData | null {
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

function safeArm(raw: Record<string, unknown> | null): Creative["arm"] {
  const impressions = Math.max(0, Math.floor(count(raw?.impressions)));
  const clicks = Math.max(0, Math.floor(count(raw?.clicks)));
  return { impressions, clicks: Math.min(clicks, impressions) };
}

function safeCreative(value: unknown): Creative | null {
  const c = record(value);
  if (!c || typeof c.id !== "string") return null;
  return {
    id: c.id,
    generation: count(c.generation),
    parentId: typeof c.parentId === "string" ? c.parentId : null,
    angle: ANGLES.includes(c.angle as CreativeAngle) ? (c.angle as CreativeAngle) : "quality",
    headline: text(c.headline),
    body: text(c.body),
    imagePrompt: text(c.imagePrompt),
    targetEmotion: text(c.targetEmotion),
    imageData: typeof c.imageData === "string" ? c.imageData : null,
    arm: safeArm(record(c.arm)),
  };
}

function safePurchase(value: unknown): PurchaseEvent | null {
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

function safeAudit(value: unknown): AuditEntry | null {
  const a = record(value);
  if (!a) return null;
  return { at: text(a.at), kind: text(a.kind), detail: text(a.detail) };
}

function safeRoundArm(value: unknown): RoundArm | null {
  const a = record(value);
  if (!a || typeof a.id !== "string") return null;
  const impressions = Math.max(0, Math.floor(count(a.impressions)));
  const clicks = Math.max(0, Math.floor(count(a.clicks)));
  return { id: a.id, impressions, clicks: Math.min(clicks, impressions) };
}

function safeRound(value: unknown): Round | null {
  const r = record(value);
  if (!r) return null;
  const arms = list(r.arms)
    .map(safeRoundArm)
    .filter((a): a is RoundArm => a !== null);
  if (arms.length === 0) return null;
  return {
    at: text(r.at),
    generation: Math.max(0, Math.floor(count(r.generation))),
    served: Math.max(0, Math.floor(count(r.served))),
    arms,
  };
}

function starterCredits(): Credits {
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

function safeCreditEntry(value: unknown): CreditEntry | null {
  const e = record(value);
  if (!e || !CREDIT_KINDS.includes(e.kind as CreditKind)) return null;
  const amount = Math.trunc(count(e.amount));
  if (amount === 0) return null;
  return { at: text(e.at), kind: e.kind as CreditKind, amount, ref: text(e.ref) };
}

function ledgerBalance(entries: CreditEntry[]): number {
  return Math.max(0, entries.reduce((sum, e) => sum + e.amount, 0));
}

function safeCredits(value: unknown): Credits {
  const c = record(value);
  if (!c) return starterCredits();
  const entries = list(c.entries)
    .map(safeCreditEntry)
    .filter((e): e is CreditEntry => e !== null)
    .slice(0, MAX_AUDIT);
  return { balance: ledgerBalance(entries), entries };
}

function mergeCredits(prev: State | null, next: State): State {
  if (!prev) return next;
  const prevGrant = prev.credits.entries.find((e) => e.kind === "grant");
  const nextGrant = next.credits.entries.find((e) => e.kind === "grant");
  if (!prevGrant || !nextGrant || prevGrant.at !== nextGrant.at || prevGrant.ref !== nextGrant.ref) {
    return next;
  }
  const seen = new Set<string>();
  const entries: CreditEntry[] = [];
  for (const entry of [...next.credits.entries, ...prev.credits.entries]) {
    const key = `${entry.kind}:${entry.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const capped = entries.slice(0, MAX_AUDIT);
  return { ...next, credits: { balance: ledgerBalance(capped), entries: capped } };
}

function mergeAudit(prev: AuditEntry[], next: AuditEntry[]): AuditEntry[] {
  const seen = new Set<string>();
  const entries: AuditEntry[] = [];
  for (const entry of [...next, ...prev]) {
    const key = `${entry.at}|${entry.kind}|${entry.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entries.slice(0, MAX_AUDIT);
}

function sanitize(value: unknown): State | null {
  const raw = record(value);
  if (!raw) return null;
  return {
    product: safeProduct(raw.product),
    productOptions: safeOptions(raw.productOptions),
    research: safeResearch(raw.research),
    insights: safeInsights(raw.insights),
    creatives: list(raw.creatives)
      .map(safeCreative)
      .filter((c): c is Creative => c !== null),
    purchases: list(raw.purchases)
      .map(safePurchase)
      .filter((p): p is PurchaseEvent => p !== null),
    audit: list(raw.audit)
      .map(safeAudit)
      .filter((a): a is AuditEntry => a !== null)
      .slice(0, MAX_AUDIT),
    rounds: list(raw.rounds)
      .map(safeRound)
      .filter((r): r is Round => r !== null)
      .slice(-MAX_ROUNDS),
    credits: safeCredits(raw.credits),
    mandateId: typeof raw.mandateId === "string" ? raw.mandateId : null,
    simulatedImpressions: count(raw.simulatedImpressions),
  };
}

function split(input: State): { clean: State; images: Images } {
  const images: Images = {};
  const creatives = input.creatives.map((c) => {
    if (c.imageData) images[c.id] = c.imageData;
    return { ...c, imageData: null };
  });
  const clean: State = {
    product: input.product,
    productOptions: input.productOptions,
    research: input.research,
    insights: input.insights,
    creatives,
    purchases: input.purchases,
    audit: input.audit,
    rounds: input.rounds,
    credits: input.credits,
    mandateId: input.mandateId,
    simulatedImpressions: input.simulatedImpressions,
  };
  return { clean, images };
}

function readRev(): number {
  try {
    const n = Number(window.localStorage.getItem(REV_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function save(value: State, rev: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    window.localStorage.setItem(REV_KEY, String(rev));
  } catch {
    return;
  }
}

function saveImages(images: Images) {
  try {
    window.localStorage.setItem(IMAGES_KEY, JSON.stringify(images));
  } catch {
    try {
      window.localStorage.removeItem(IMAGES_KEY);
    } catch {
      return;
    }
  }
}

function storedRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function dropImages() {
  try {
    window.localStorage.removeItem(IMAGES_KEY);
  } catch {
    return;
  }
}

function restoreImages(): Images {
  try {
    const raw = window.localStorage.getItem(IMAGES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Images = {};
    for (const [id, data] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof data === "string" && data.startsWith("data:image/")) out[id] = data;
    }
    return out;
  } catch {
    return {};
  }
}

function forget() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(IMAGES_KEY);
    window.localStorage.removeItem(REV_KEY);
  } catch {
    return;
  }
}

function dropped(raw: Record<string, unknown>, safe: State): number {
  const audit = Math.min(list(raw.audit).length, MAX_AUDIT);
  return (
    list(raw.creatives).length -
    safe.creatives.length +
    (list(raw.purchases).length - safe.purchases.length) +
    (audit - safe.audit.length)
  );
}

function restore(): { state: State | null; notice: string | null } {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { state: null, notice: null };
  }
  if (!stored) return { state: null, notice: null };

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stored);
  } catch {
    forget();
    return { state: null, notice: UNREADABLE };
  }

  const raw = record(parsed);
  const safe = raw ? sanitize(raw) : null;
  if (!raw || !safe) {
    forget();
    return { state: null, notice: UNREADABLE };
  }
  return { state: safe, notice: dropped(raw, safe) > 0 ? PATCHED : null };
}

interface DecideResponse {
  decision: Decision;
  evaluation: Evaluation;
  state: State;
}

type PurchaseResponse = State & { lastPurchase?: LastPurchase };

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

function Action({
  index,
  label,
  hint,
  onClick,
  disabled,
  running,
  done,
}: {
  index: number;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  running?: boolean;
  done?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        done
          ? "border-white/25 bg-white/[0.07] hover:bg-white/[0.12]"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.08]"
      } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/[0.03]`}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-white">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
            done ? "bg-white text-zinc-950" : "bg-white/10 text-zinc-400"
          }`}
        >
          {index}
        </span>
        <span className="min-w-0 break-words">{running ? "Working" : label}</span>
      </span>
      <span className="break-words text-[12px] leading-snug text-zinc-400">{hint}</span>
    </button>
  );
}

const WIDE = "(min-width: 640px)";

function subscribeWide(notify: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full border border-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  sim,
  dim,
}: {
  label: string;
  value: string;
  sim?: boolean;
  dim?: boolean;
}) {
  return (
    <div className="min-w-0 bg-zinc-950 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">
          {label}
        </span>
        {sim ? (
          <span className="shrink-0 rounded border border-white/12 px-1 py-px text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Sim
          </span>
        ) : null}
      </div>
      <div
        className={`mt-1 truncate text-[17px] font-semibold leading-tight tabular-nums ${
          dim ? "text-zinc-400" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Caret() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
      <path
        d="M2.5 4.5L6 8l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Band({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto mt-12 w-full max-w-5xl sm:mt-16">
      <div className="rounded-3xl border border-white/[0.07] bg-white/[0.012] p-3 sm:p-5">
        <div className="border-b border-white/[0.07] px-1 pb-4 sm:pb-5">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-px w-5 shrink-0 bg-white/25" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
              {eyebrow}
            </span>
          </div>
          <h2 className="mt-2 break-words text-lg font-semibold tracking-tight text-white sm:text-xl">
            {title}
          </h2>
          <p className="mt-1.5 max-w-2xl break-words text-[13px] leading-relaxed text-zinc-400">
            {summary}
          </p>
        </div>
        <div className="mt-4 space-y-3 sm:mt-5">{children}</div>
      </div>
    </section>
  );
}

interface Upcoming {
  title: string;
  text: string;
}

function Preview({ items }: { items: Upcoming[] }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
        What this run fills in
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li
            key={item.title}
            className="min-w-0 break-words rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[12px] leading-snug text-zinc-200"
          >
            {item.title}
          </li>
        ))}
      </ul>
      <p className="mt-2 break-words text-[12px] leading-relaxed text-zinc-400">
        Each panel opens itself the moment the run produces the data behind it, so nothing on screen
        is an empty box. The proof lab further down needs no run at all: it replays thousands of
        tests in your own browser and scores the four gates against the obvious rule.
      </p>
    </div>
  );
}

function evidence(evaluation: Evaluation): string {
  const value = evaluation.eValue;
  if (typeof value !== "number") return "not measured";
  if (!Number.isFinite(value)) return `past ${EVIDENCE_TARGET}`;
  return `${strength(value)} of ${EVIDENCE_TARGET}`;
}

function outcome(
  amount: string | number | null | undefined,
  code: string | null | undefined,
): { guardrail: boolean; text: string } {
  const family = declineFamily(code);
  const shown = code ?? "no reason code";
  const at = `$${money(amount)}`;
  if (family === "guardrail") {
    return { guardrail: true, text: `Blocked at ${at}: ${shown}. Nothing was spent.` };
  }
  if (family === "provider") {
    return {
      guardrail: false,
      text: `Not processed at ${at}: ${shown} is a payment provider fault, not the mandate. Nothing was spent and no mandate rule refused it.`,
    };
  }
  if (family === "request") {
    return {
      guardrail: false,
      text: `Not processed at ${at}: ${shown} rejected the request itself, not the mandate. Nothing was spent and no mandate rule refused it.`,
    };
  }
  return {
    guardrail: false,
    text: `Not processed at ${at}: ${shown} came back without saying whether a mandate rule stopped it. Nothing was spent.`,
  };
}

function Note({
  note,
  onJump,
}: {
  note: ManualNote;
  onJump: (target: "ledger" | "ads") => void;
}) {
  const target = note.target;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-snug ${
        note.ok
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
          : note.warn
            ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
            : "border-rose-400/40 bg-rose-500/10 text-rose-100"
      }`}
    >
      <span className="min-w-0 break-words">{note.text}</span>
      {target ? (
        <button
          type="button"
          onClick={() => onJump(target)}
          className="shrink-0 rounded-lg border border-white/20 bg-white/[0.06] px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/[0.14]"
        >
          {target === "ledger" ? "Show it in the ledger" : "Show the ads"}
        </button>
      ) : null}
    </div>
  );
}

function Fold({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? defaultOpen;
  const panel = useId();

  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setChoice(!open)}
        className="flex min-h-[3.5rem] w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3 text-left transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.05] sm:px-4"
      >
        <span className="min-w-0">
          <span className="block break-words text-[14px] font-semibold text-zinc-100">{title}</span>
          <span className="mt-0.5 block break-words text-[12px] leading-snug text-zinc-400">
            {hint}
          </span>
        </span>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-white/[0.05] text-zinc-300 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          <Caret />
        </span>
      </button>
      <div id={panel} className={open ? "mt-3" : "hidden"}>
        {children}
      </div>
    </section>
  );
}

interface ImageResponse {
  creativeId: string;
  imageData: string;
  state?: State;
}

type ManualSlot = "steps" | "traffic" | "charge";

interface ManualNote {
  ok: boolean;
  warn?: boolean;
  text: string;
  slot: ManualSlot;
  target?: "ledger" | "ads";
}

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const stateRef = useRef<State | null>(null);
  const [images, setImages] = useState<Images>({});
  const [rendering, setRendering] = useState<Set<string>>(() => new Set());
  const requested = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState<Task | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [receipt, setReceipt] = useState<LastPurchase | null>(null);
  const [impressions, setImpressions] = useState(1000);
  const [autoRunning, setAutoRunning] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [stale, setStale] = useState(false);
  const [manual, setManual] = useState<ManualNote | null>(null);
  const [advising, setAdvising] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const optionsAsked = useRef<string | null>(null);
  const staleRef = useRef(false);
  const revRef = useRef(0);
  const ledgerRef = useRef<HTMLElement | null>(null);
  const adsRef = useRef<HTMLElement | null>(null);
  const wide = useWide();
  const history = useSyncExternalStore(subscribeHistory, historySnapshot, serverHistory);

  const take = useCallback((sane: State) => {
    const { clean, images: found } = split(sane);
    stateRef.current = clean;
    setState(clean);
    if (Object.keys(found).length > 0) {
      setImages((prev) => {
        const merged = { ...prev, ...found };
        saveImages(merged);
        return merged;
      });
    }
    return clean;
  }, []);

  const absorb = useCallback(
    (next: State) => {
      const sane = sanitize(next);
      if (!sane) throw new Error("The server answered with something this run could not read. Nothing was changed.");

      const clean = take(mergeCredits(stateRef.current, sane));
      if (staleRef.current) return clean;
      const rev = Math.max(readRev(), revRef.current) + 1;
      revRef.current = rev;
      save(clean, rev);
      return clean;
    },
    [take],
  );

  const adopt = useCallback(() => {
    const { state: stored } = restore();
    revRef.current = Math.max(readRev(), revRef.current);
    staleRef.current = false;
    setStale(false);
    if (stored) take(stored);
  }, [take]);

  const absorbLedger = useCallback(
    (next: State) => {
      const base = stateRef.current;
      if (!base) return absorb(next);
      return absorb({ ...base, credits: next.credits, audit: mergeAudit(base.audit, next.audit) });
    },
    [absorb],
  );

  const carryDecision = useCallback((next: Decision | null, evaluated: Evaluation | null) => {
    setDecision(next);
    setEvaluation(evaluated);
  }, []);

  const run = useCallback(async (task: Task, fn: () => Promise<void>) => {
    setBusy(task);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something broke on the way to the server");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      const cached = restoreImages();
      if (alive && Object.keys(cached).length > 0) setImages(cached);

      const { state: stored, notice: warning } = restore();
      if (alive && warning) setNotice(warning);
      if (stored) {
        if (alive) {
          absorb(stored);
          setBusy(null);
        }
        return;
      }
      try {
        const fresh = await api<State>("/api/product");
        if (alive) absorb(fresh);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not reach the agent");
      } finally {
        if (alive) setBusy(null);
      }
    };
    void boot();
    return () => {
      alive = false;
    };
  }, [absorb]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY && e.key !== REV_KEY) return;
      if (readRev() <= revRef.current) return;
      if (busy !== null || autoRunning) {
        staleRef.current = true;
        setStale(true);
        return;
      }
      adopt();
      setNotice(ADOPTED);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [adopt, busy, autoRunning]);

  const creatives = useMemo(() => state?.creatives ?? [], [state]);
  const generation = creatives.length ? Math.max(...creatives.map((c) => c.generation)) : 0;
  const cohort = useMemo(
    () => creatives.filter((c) => c.generation === generation),
    [creatives, generation],
  );

  const byId = useMemo(() => {
    const map = new Map<string, Creative>();
    creatives.forEach((c) => map.set(c.id, c));
    return map;
  }, [creatives]);

  const freshEvaluation = evaluation && evaluation.generation === generation ? evaluation : null;
  const winnerId = freshEvaluation?.candidateId ?? null;
  const leaderId = useMemo(() => {
    const scored = cohort.filter((c) => c.arm.impressions > 0);
    if (scored.length === 0) return null;
    return scored.reduce((best, c) =>
      ctr(c.arm.impressions, c.arm.clicks) > ctr(best.arm.impressions, best.arm.clicks) ? c : best,
    ).id;
  }, [cohort]);
  const bestCtr = useMemo(
    () => cohort.reduce((max, c) => Math.max(max, ctr(c.arm.impressions, c.arm.clicks)), 0),
    [cohort],
  );
  const dressed = useCallback(
    (c: Creative): Creative => ({ ...c, imageData: c.imageData ?? images[c.id] ?? null }),
    [images],
  );

  const settle = useCallback((id: string) => {
    setRendering((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const missing = creatives.filter(
      (c) => !c.imageData && !images[c.id] && c.imagePrompt && !requested.current.has(c.id),
    );
    if (missing.length === 0) return;

    missing.forEach((c) => requested.current.add(c.id));
    setRendering((prev) => {
      const next = new Set(prev);
      missing.forEach((c) => next.add(c.id));
      return next;
    });

    missing.forEach((c) => {
      const draw = async () => {
        try {
          const res = await api<ImageResponse>("/api/image", {
            creativeId: c.id,
            imagePrompt: c.imagePrompt,
            state: stateRef.current,
          });
          if (res.state) absorbLedger(res.state);
          setImages((prev) => {
            const merged = { ...prev, [c.id]: res.imageData };
            saveImages(merged);
            return merged;
          });
        } catch (e) {
          if (e instanceof ApiError && e.status === 402) setNotice(e.message);
        } finally {
          settle(c.id);
        }
      };
      void draw().catch(() => settle(c.id));
    });
  }, [creatives, images, settle, absorbLedger]);

  const winner = winnerId ? byId.get(winnerId) : undefined;
  const cohortImpressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const candidateImpressions = freshEvaluation
    ? (winner ?? cohort[freshEvaluation.candidateIndex])?.arm.impressions
    : undefined;

  const purchases = state?.purchases ?? [];
  const latestPurchase = purchases[0] ?? null;
  const heldOnMandate = Boolean(
    decision && !decision.shouldBuy && freshEvaluation?.sufficientEvidence,
  );
  const declinedOnMandate = Boolean(
    latestPurchase && !latestPurchase.ok && declineFamily(latestPurchase.errorCode) === "guardrail",
  );
  const mandateBlocked = heldOnMandate || declinedOnMandate;
  const receiptRead = receipt && !receipt.ok ? outcome(receipt.amount, receipt.errorCode) : null;
  const hasProduct = Boolean(state?.product);
  const hasResearch = Boolean(state?.research);
  const hasCreatives = cohort.length > 0;
  const hasTraffic = cohortImpressions > 0;
  const hasPurchases = purchases.length > 0;
  const hasAudit = (state?.audit ?? []).length > 0;
  const hasHistory = history.length > 0;
  const locked = busy !== null || autoRunning || stale || advising;

  const askOptions = useCallback(async () => {
    const base = stateRef.current;
    if (!base?.product) return;
    setOptionsLoading(true);
    setOptionsFailed(false);
    try {
      const next = await api<State>("/api/refine", { state: base });
      const current = stateRef.current;
      if (!current?.product) return;
      absorb({
        ...current,
        productOptions: next.productOptions,
        audit: mergeAudit(current.audit, next.audit),
      });
    } catch {
      setOptionsFailed(true);
    } finally {
      setOptionsLoading(false);
    }
  }, [absorb]);

  const productName = state?.product?.name ?? null;
  const productOptions = state?.productOptions ?? null;

  useEffect(() => {
    if (!productName || productOptions || hasTraffic) return;
    if (optionsAsked.current === productName) return;
    optionsAsked.current = productName;
    void askOptions();
  }, [productName, productOptions, hasTraffic, askOptions]);

  const refine = (patch: { variant?: string; brand?: string; price?: string }) => {
    const base = stateRef.current;
    if (!base?.product) return;
    absorb({ ...base, product: { ...base.product, ...patch } });
  };

  const retryOptions = () => {
    optionsAsked.current = productName;
    void askOptions();
  };

  const switchProduct = (
    next: { name: string; price: string; description: string },
    restart: boolean,
  ) => {
    const base = stateRef.current;
    if (!base?.product || locked) return;

    if (!restart) {
      absorb({
        ...base,
        product: { ...base.product, price: next.price, description: next.description },
        audit: mergeAudit(base.audit, [
          {
            at: new Date().toISOString(),
            kind: "product",
            detail: `Seller corrected the listing for "${base.product.name}": ${next.price}, ${next.description}`,
          },
        ]),
      });
      setNotice(
        `The listing for ${base.product.name} was corrected. The ads, the traffic and the evidence behind them were left alone.`,
      );
      return;
    }

    void run("load", async () => {
      const previous = base.product?.name ?? "";
      const res = await api<State>("/api/product", {
        name: next.name,
        price: next.price,
        description: next.description,
        marketContext: base.product?.marketContext ?? "",
        state: base,
      });
      const filed = archiveRun(storedRaw());
      dropImages();
      setImages({});
      requested.current = new Set();
      setRendering(new Set());
      setDecision(null);
      setEvaluation(null);
      setReceipt(null);
      setManual(null);
      optionsAsked.current = null;
      absorb(res);
      setNotice(
        filed
          ? `${next.name} is on the board and the run starts clean. The ${previous} run was archived under Earlier runs.`
          : `${next.name} is on the board and the run starts clean.`,
      );
    });
  };

  const upcoming = useMemo(() => {
    const items: Upcoming[] = [];
    if (!hasCreatives) {
      items.push({
        title: "The four ads it wrote",
        text: "Four angles with generated images, each one an arm the bandit can bet traffic on.",
      });
    }
    if (!hasTraffic) {
      items.push({
        title: "Campaign numbers",
        text: "Impressions, click through rate, cost per click and the budget against the mandate cap.",
      });
    }
    if (!hasTraffic) {
      items.push({
        title: "Belief curves and the four gates",
        text: "How sure it is about every ad, and each condition the evidence had to clear before spending.",
      });
    }
    if (!hasTraffic) {
      items.push({
        title: "What it recommends next",
        text: "The read on the winning angle and the competitor plays nobody has tested yet.",
      });
    }
    if (!hasCreatives) {
      items.push({
        title: "Lineage of the winners",
        text: "Which ad bred which across generations, and what each step cost.",
      });
    }
    if (!hasPurchases) {
      items.push({
        title: "The payment ledger",
        text: "Every single use card the mandate approved or refused, newest first.",
      });
    }
    if (!hasAudit) {
      items.push({
        title: "Audit log",
        text: "Every call, every decision and every charge, in the order they happened.",
      });
    }
    return items;
  }, [hasCreatives, hasTraffic, hasPurchases, hasAudit]);

  const focused = upcoming.length > 0;

  const advise = async () => {
    if (locked) return;
    setAdvising(true);
    setError(null);
    try {
      absorb(await api<State>("/api/insights", { state }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something broke on the way to the server");
    } finally {
      setAdvising(false);
    }
  };

  const runManual = async (task: Task, slot: ManualSlot, fn: () => Promise<ManualNote>) => {
    setBusy(task);
    setError(null);
    setManual(null);
    try {
      setManual(await fn());
    } catch (e) {
      const text = e instanceof Error ? e.message : "Something broke on the way to the server";
      setError(text);
      setManual({ ok: false, text, slot });
    } finally {
      setBusy(null);
    }
  };

  const charged = (p: LastPurchase | undefined): ManualNote => {
    if (!p) {
      return {
        ok: false,
        slot: "charge",
        text: "The charge came back with nothing to show for it.",
        target: "ledger",
      };
    }
    if (p.ok) {
      return {
        ok: true,
        slot: "charge",
        text:
          p.message ??
          `Charged $${money(p.amount)} on a single use card ending ${p.cardLast4 ?? "????"}.`,
        target: "ledger",
      };
    }
    const read = outcome(p.amount, p.errorCode);
    return {
      ok: false,
      warn: !read.guardrail,
      slot: "charge",
      text: `${read.text}${p.message ? ` ${p.message}` : ""}`,
      target: "ledger",
    };
  };

  const research = () =>
    runManual("research", "steps", async () => {
      const next = absorb(await api<State>("/api/research", { state }));
      return {
        ok: true,
        slot: "steps",
        text: next.research
          ? `The market read is in, ${next.research.sources.length} ${
              next.research.sources.length === 1 ? "source" : "sources"
            } kept. Market research under Evidence has the whole of it.`
          : "The agent answered without any research to show.",
      };
    });

  const generate = (parentId?: string) => {
    if (locked) return;
    return runManual(parentId ? "evolve" : "creatives", "steps", async () => {
      const next = absorb(
        await api<State>("/api/creatives", parentId ? { parentId, state } : { state }),
      );
      setDecision(null);
      setEvaluation(null);
      const top = next.creatives.length ? Math.max(...next.creatives.map((c) => c.generation)) : 0;
      const made = next.creatives.filter((c) => c.generation === top).length;
      return {
        ok: true,
        slot: "steps",
        text: `${made} ${made === 1 ? "ad is" : "ads are"} on the board in generation ${top}.`,
        target: "ads",
      };
    });
  };

  const simulate = () =>
    runManual("simulate", "traffic", async () => {
      const next = absorb(await api<State>("/api/simulate", { impressions, state }));
      const top = next.creatives.length ? Math.max(...next.creatives.map((c) => c.generation)) : 0;
      const served = next.creatives
        .filter((c) => c.generation === top)
        .reduce((sum, c) => sum + c.arm.impressions, 0);
      return {
        ok: true,
        slot: "traffic",
        text: `Served ${impressions.toLocaleString()} simulated impressions. This generation is on ${served.toLocaleString()} now.`,
        target: "ads",
      };
    });

  const decide = () =>
    runManual("decide", "steps", async () => {
      const res = await api<DecideResponse>("/api/decide", { state });
      absorb(res.state);
      setDecision(res.decision);
      setEvaluation(res.evaluation);
      return {
        ok: true,
        slot: "steps",
        text: res.decision.shouldBuy
          ? `It wants to spend $${money(res.decision.amount)}. The card at the top of the page carries its reason and the button that lets it.`
          : "It held the money. The card at the top of the page carries the reason, and the four gates below say which one stopped it.",
      };
    });

  const purchase = () =>
    run("purchase", async () => {
      const res = await api<PurchaseResponse>("/api/purchase", {
        amount: decision?.amount ?? "4.00",
        reason: decision?.reason ?? "Bandit called the winner",
        winnerId: winnerId ?? cohort[0]?.id,
        probabilityBest: freshEvaluation?.probabilityBest ?? 0,
        impressions: cohortImpressions,
        state,
      });
      absorb(res);
      setReceipt(res.lastPurchase ?? null);
    });

  const forceReject = () =>
    runManual("force", "charge", async () => {
      const res = await api<PurchaseResponse>("/api/purchase", {
        reason:
          "Deliberate over cap charge, fired by hand to show the mandate refusing the agent instead of paying it",
        winnerId: winnerId ?? cohort[0]?.id,
        probabilityBest: freshEvaluation?.probabilityBest ?? 0,
        impressions: cohortImpressions,
        force: true,
        state,
      });
      absorb(res);
      setReceipt(res.lastPurchase ?? null);
      return charged(res.lastPurchase);
    });

  const forceMerchantReject = () =>
    runManual("scope", "charge", async () => {
      const res = await api<PurchaseResponse>("/api/purchase", {
        reason:
          "Deliberate charge for the render credits merchant against the mandate signed for Allbirds, fired by hand to show the merchant lock refusing the agent",
        winnerId: winnerId ?? cohort[0]?.id,
        probabilityBest: freshEvaluation?.probabilityBest ?? 0,
        impressions: cohortImpressions,
        force: "merchant",
        state,
      });
      absorb(res);
      setReceipt(res.lastPurchase ?? null);
      return charged(res.lastPurchase);
    });

  const jump = (target: "ledger" | "ads") => {
    const node = target === "ledger" ? ledgerRef.current : adsRef.current;
    if (!node) return;
    const top = node.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  };

  const revoke = () =>
    run("revoke", async () => {
      const res = await api<PurchaseResponse>("/api/mandate/revoke", { state });
      absorb(res);
      setRevoked(true);
    });

  return (
    <div
      className="min-h-screen bg-zinc-950 font-sans text-zinc-100"
      style={{ "--ring": "rgba(244, 244, 245, 0.92)" } as CSSProperties}
    >
      <MandateBar
        mandateId={state?.mandateId ?? null}
        cap={MANDATE_CAP}
        purchases={purchases}
        working={locked}
        chargeable={!mandateBlocked && !revoked}
        revoked={revoked}
        onRevoke={revoke}
      />

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
        <div className="space-y-4 sm:space-y-5">
        {notice ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] leading-snug text-zinc-300">
            <span className="min-w-0 break-words py-1">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="-mr-2 flex min-h-[2.75rem] shrink-0 items-center px-2 text-[12px] uppercase tracking-wider text-zinc-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-200">
            {error}
          </div>
        ) : null}

        {stale ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-[13px] leading-snug text-amber-100">
            <span className="min-w-0 break-words">
              Another tab of this dashboard is further along than this one. Acting here would write
              the older run over the newer one, so the controls are off and anything this tab
              finished since then is on screen but not saved. Catch up and the newer run takes over.
            </span>
            <button
              type="button"
              onClick={() => {
                adopt();
                setNotice(ADOPTED);
              }}
              className="shrink-0 rounded-lg border border-white/20 bg-white/[0.06] px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/[0.14]"
            >
              Catch up with the newer tab
            </button>
          </div>
        ) : null}

        <section>
          {state?.product ? (
            <ProductBar
              product={state.product}
              options={productOptions}
              optionsLoading={optionsLoading}
              optionsFailed={optionsFailed}
              refinable={!hasTraffic}
              hasRun={hasCreatives || hasTraffic}
              disabled={locked}
              onRefine={refine}
              onRetryOptions={retryOptions}
              onApply={switchProduct}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="min-w-0 break-words text-[19px] font-semibold tracking-tight text-white sm:text-xl">
                {busy === "load" ? "Loading the agent state" : "No product yet"}
              </h1>
              <Link
                href="/"
                className="inline-flex min-h-[2.75rem] items-center rounded-xl bg-white px-4 text-[13px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
              >
                Submit one
              </Link>
            </div>
          )}
        </section>

        <div className={focused ? "py-2 sm:py-4" : ""}>
          <DemoRunner
            key={productName ?? "no-product"}
            state={state}
            absorb={absorb}
            impressions={impressions}
            disabled={busy !== null || stale}
            running={autoRunning}
            onRunningChange={setAutoRunning}
            onDecision={carryDecision}
            onReceipt={setReceipt}
            footer={focused ? <Preview items={upcoming} /> : null}
          />
        </div>

        {busy && busy !== "load" ? (
          <AgentStatus title={AGENT_STEPS[busy].title} steps={AGENT_STEPS[busy].steps} />
        ) : null}

        {receipt ? (
          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-[14px] ${
              receipt.ok
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                : receiptRead?.guardrail
                  ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-200"
            }`}
          >
            <span className="min-w-0 break-words py-1.5">
              {receipt.ok
                ? `Charged $${money(receipt.amount)} on a single use card ending ${receipt.cardLast4 ?? "????"}.`
                : (receiptRead?.text ?? "")}
            </span>
            <button
              type="button"
              onClick={() => setReceipt(null)}
              className="-mr-2 flex min-h-[2.75rem] shrink-0 items-center px-2 text-[12px] uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {hasTraffic ? (
          <AgentReadout
            cohort={cohort}
            generation={generation}
            evaluation={freshEvaluation}
            winnerId={winnerId}
          />
        ) : null}

        {decision && freshEvaluation ? (
          <section
            className={`rounded-2xl border p-4 sm:p-5 ${
              decision.shouldBuy ? "border-white/25 bg-white/[0.05]" : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
                  decision.shouldBuy ? "bg-white text-zinc-950" : "bg-white/10 text-zinc-300"
                }`}
              >
                {decision.shouldBuy ? "Spending" : "Holding"}
              </span>
              <h2 className="min-w-0 break-words text-[15px] font-semibold text-white sm:text-base">
                {decision.shouldBuy
                  ? `The agent wants to spend $${money(decision.amount)}`
                  : "The agent kept the money in its pocket"}
              </h2>
              <span className="rounded-full border border-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Decided on simulated traffic
              </span>
            </div>

            <p className="mt-2 text-[14px] leading-relaxed text-zinc-200">
              {plain(
                decision.shouldBuy ? decision.reason : (decision.abstainedBecause ?? decision.reason),
              )}
            </p>

            {!decision.shouldBuy && decision.trafficPlan ? (
              <div className="mt-3 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  The agent set the next step itself
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-200">
                  It asked for {decision.trafficPlan.targetImpressions.toLocaleString()} impressions
                  on the board before it reads the evidence again. {plain(decision.trafficPlan.reason)}
                </p>
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/[0.08] sm:grid-cols-4">
              <Stat label="Probability best" value={pct(freshEvaluation.probabilityBest)} sim />
              <Stat
                label="Evidence strength"
                value={evidence(freshEvaluation)}
                dim={!freshEvaluation.sufficientEvidence}
              />
              <Stat
                label="Impressions"
                value={freshEvaluation.totalImpressions.toLocaleString()}
                sim
              />
              <Stat label="Candidate" value={winner ? winner.angle : "none"} dim={!winner} />
            </div>

            {decision.shouldBuy ? (
              <button
                type="button"
                onClick={purchase}
                disabled={locked}
                className="mt-4 min-h-[3.25rem] w-full rounded-xl bg-white px-4 py-3 text-[15px] font-bold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "purchase"
                  ? "Charging the mandate"
                  : `Let it spend $${money(decision.amount)}`}
              </button>
            ) : null}
          </section>
        ) : null}

        {hasCreatives ? (
          <Reveal>
            <section ref={adsRef} className="scroll-mt-20 space-y-4 pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold tracking-tight text-white sm:text-lg">
                    The four ads it wrote
                  </h2>
                  <Chip>Simulated traffic</Chip>
                </div>
                <span className="text-[12px] tabular-nums text-zinc-400">
                  {cohort.length} live in generation {generation},{" "}
                  {cohortImpressions.toLocaleString()} simulated impressions
                </span>
              </div>

              <div className="-mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
                {cohort.map((c, i) => (
                  <div key={c.id} className="w-[86%] shrink-0 snap-start sm:w-auto">
                    <CreativeCard
                      index={i}
                      creative={dressed(c)}
                      productName={state?.product?.name ?? null}
                      rendering={rendering.has(c.id)}
                      isWinner={c.id === winnerId}
                      isLeader={c.id !== winnerId && c.id === leaderId}
                      probabilityBest={freshEvaluation?.probabilityBest ?? null}
                      bestCtr={bestCtr}
                      parentHeadline={c.parentId ? (byId.get(c.parentId)?.headline ?? null) : null}
                      onEvolve={generate}
                      evolving={busy === "evolve"}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[12px] leading-snug text-zinc-400 sm:hidden">
                Swipe sideways to put the {cohort.length} ads next to each other.
              </p>

              {creatives.length > cohort.length ? (
                <Fold
                  title="Retired variants"
                  hint={`The ${creatives.length - cohort.length} ads from earlier generations, kept so you can see what the winner beat.`}
                >
                  <div className="-mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
                    {creatives
                      .filter((c) => c.generation !== generation)
                      .map((c) => (
                        <div key={c.id} className="w-[86%] shrink-0 snap-start sm:w-auto">
                          <CreativeCard
                            creative={dressed(c)}
                            rendering={rendering.has(c.id)}
                            retired
                            bestCtr={bestCtr}
                            parentHeadline={
                              c.parentId ? (byId.get(c.parentId)?.headline ?? null) : null
                            }
                          />
                        </div>
                      ))}
                  </div>
                </Fold>
              ) : null}
            </section>
          </Reveal>
        ) : null}

        {hasTraffic ? (
          <Reveal delay={60}>
            <CampaignMetrics
              cohort={cohort}
              creatives={creatives}
              purchases={purchases}
              cap={MANDATE_CAP}
              credits={state?.credits.balance ?? 0}
              evaluation={freshEvaluation}
              winnerId={winnerId}
              generation={generation}
            />
          </Reveal>
        ) : null}

        {hasTraffic ? (
          <Reveal delay={120}>
            <PerformanceChart
              cohort={cohort}
              winnerId={winnerId}
              generation={generation}
              rounds={state?.rounds ?? []}
            />
          </Reveal>
        ) : null}

        </div>

        <Band
          eyebrow="Evidence"
          title={hasTraffic ? "Why it decided that" : "Check the rule before you trust the run"}
          summary={
            hasTraffic
              ? "Everything the agent read before it was allowed to spend: what it recommends you do next off that evidence, what it believes about each ad, the four gates it has to clear, the family tree of winners, the market it researched, and a lab that lets you measure the gates against the obvious rule yourself."
              : "The proof lab needs no agent and no run behind it. It replays thousands of tests in your own browser and scores the four gates against the rule most teams stop on. What the agent believed about each ad, and the gates it had to clear, land beside it once the run has numbers."
          }
        >
          {hasTraffic ? (
            <Reveal>
              <Fold
                title="What it recommends you do next"
                hint="What the winning angle says about the buyers, the competitor plays nobody has tested, and what the numbers can and cannot estimate."
                defaultOpen={wide || Boolean(state?.insights)}
              >
                <Insights
                  insights={state?.insights ?? null}
                  generation={generation}
                  impressions={cohortImpressions}
                  hasResearch={hasResearch}
                  hasTraffic={hasTraffic}
                  running={advising}
                  disabled={locked}
                  onRun={advise}
                />
              </Fold>
            </Reveal>
          ) : null}

          {hasTraffic ? (
            <Reveal delay={60}>
              <Fold
                title="The belief curves"
                hint="How sure the agent is about each ad's click rate. Wide is uncertainty, narrow is confidence."
                defaultOpen={wide}
              >
                <PosteriorChart
                  creatives={cohort}
                  winnerIndex={winnerId ? cohort.findIndex((c) => c.id === winnerId) : null}
                />
              </Fold>
            </Reveal>
          ) : null}

          {hasTraffic ? (
            <Reveal delay={120}>
              <Fold
                title="The four gates"
                hint={
                  freshEvaluation
                    ? "Every condition the evidence had to clear before the agent was allowed to spend."
                    : "Nothing measured yet. Open it to read the four conditions the agent has to clear."
                }
                defaultOpen={wide || Boolean(freshEvaluation)}
              >
                <GatesPanel
                  evaluation={freshEvaluation}
                  candidateImpressions={candidateImpressions}
                  candidateLabel={cohort.find((c) => c.id === winnerId)?.headline}
                  mandateBlocked={mandateBlocked}
                />
              </Fold>
            </Reveal>
          ) : null}

          {hasCreatives ? (
            <Reveal delay={180}>
              <Fold
                title="Lineage of the winners"
                hint="Which ad bred which, and what the agent paid to get from one generation to the next."
              >
                <LineageTree
                  creatives={state?.creatives ?? []}
                  winnerId={winnerId}
                  purchases={purchases}
                />
              </Fold>
            </Reveal>
          ) : null}

          {hasResearch ? (
            <Reveal delay={240}>
              <Fold
                title="Market research"
                hint="Who buys this, what competitors say, where the price lands, and every source read."
              >
                <MarketPanel research={state?.research ?? null} productName={state?.product?.name} />
              </Fold>
            </Reveal>
          ) : null}

          {hasTraffic ? (
            <ProofLab tone="panel" folded batchSize={200} />
          ) : (
            <ProofLab tone="panel" batchSize={200} />
          )}
        </Band>

        <Band
          eyebrow="Trail"
          title="What it left behind"
          summary={
            hasPurchases
              ? "The money it actually moved, the log of every move, and the manual controls for anyone who wants to drive it by hand."
              : "The manual controls for anyone who wants to drive it by hand. The money it moved and the log of every move join them the first time the agent reaches for the card."
          }
        >
          {hasPurchases ? (
            <Reveal>
              <section ref={ledgerRef} className="scroll-mt-20 space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="text-[14px] font-semibold tracking-tight text-white">
                      Money it moved
                    </h3>
                    <Chip>Sandbox payments</Chip>
                  </div>
                  <span className="max-w-md break-words text-[11px] leading-snug text-zinc-400">
                    Single use cards, newest first. The impressions and confidence on each charge
                    come from simulated traffic.
                  </span>
                </div>

                <PurchaseLedger
                  events={purchases}
                  headlineFor={(id) => byId.get(id)?.headline ?? null}
                />
              </section>
            </Reveal>
          ) : null}

          {hasCreatives ? (
            <Reveal delay={60}>
              <RunExport state={state} images={images} evaluation={freshEvaluation} />
            </Reveal>
          ) : null}

          <Fold
            title="Run it step by step"
            hint={`Manual controls for research, creatives, traffic and the spend decision. Generation ${generation}.`}
          >
            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Action
                  index={1}
                  label="Research the market"
                  hint="Live web search on who buys this"
                  onClick={research}
                  disabled={locked || !hasProduct}
                  running={busy === "research"}
                  done={hasResearch}
                />
                <Action
                  index={2}
                  label={hasCreatives ? "Generate 4 more" : "Generate 4 creatives"}
                  hint="Four angles, four images, four arms"
                  onClick={() => generate()}
                  disabled={locked || !hasResearch}
                  running={busy === "creatives"}
                  done={hasCreatives}
                />
                <Action
                  index={4}
                  label="Decide the spend"
                  hint="Thompson sampling plus the mandate rules"
                  onClick={decide}
                  disabled={locked || !hasTraffic}
                  running={busy === "decide"}
                  done={Boolean(freshEvaluation)}
                />
              </div>

              {manual && manual.slot === "steps" ? (
                <Note note={manual} onJump={jump} />
              ) : null}

              <div className="rounded-xl border border-white/12 bg-white/[0.03] p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-white/10 text-[10px] font-bold text-zinc-300">
                        3
                      </span>
                      <h4 className="text-[14px] font-semibold text-white">Simulate traffic</h4>
                      <span className="rounded-full border border-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Simulated
                      </span>
                    </div>
                    <p className="mt-1 max-w-xl break-words text-[12px] leading-relaxed text-zinc-400">
                      Fire it yourself. Impressions are allocated by Thompson sampling and clicks
                      come from a hidden rate per creative. These numbers are generated, not real ad
                      data.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[500, 1000, 5000].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setImpressions(n)}
                          className={`min-h-[2.75rem] min-w-[4.5rem] rounded-lg border px-3 text-[13px] font-semibold tabular-nums transition-colors ${
                            impressions === n
                              ? "border-white/30 bg-white/15 text-white"
                              : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07]"
                          }`}
                        >
                          {n.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={simulate}
                    disabled={locked || !hasCreatives}
                    className="min-h-[2.75rem] w-full shrink-0 rounded-xl border border-white/25 bg-white/[0.08] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.15] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                  >
                    {busy === "simulate"
                      ? "Serving impressions"
                      : `Serve ${impressions.toLocaleString()} impressions`}
                  </button>
                </div>

                {manual && manual.slot === "traffic" ? (
                  <div className="mt-3">
                    <Note note={manual} onJump={jump} />
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={forceReject}
                disabled={locked}
                className="w-full rounded-xl border border-rose-400/30 bg-rose-500/[0.07] px-3 py-2.5 text-left transition-colors hover:bg-rose-500/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="text-[13px] font-semibold text-rose-200">
                  {busy === "force" ? "Sending the over cap charge" : "Force a charge over the cap"}
                </span>
                <span className="mt-0.5 block break-words text-[12px] leading-snug text-zinc-400">
                  Fires a charge ten times the ceiling on purpose. The mandate refuses it and the
                  refusal appears right under this button with its reason. Nothing is spent.
                </span>
              </button>

              <button
                type="button"
                onClick={forceMerchantReject}
                disabled={locked}
                className="w-full rounded-xl border border-rose-400/30 bg-rose-500/[0.07] px-3 py-2.5 text-left transition-colors hover:bg-rose-500/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="text-[13px] font-semibold text-rose-200">
                  {busy === "scope"
                    ? "Sending the off scope charge"
                    : "Force a charge outside the mandate's merchant"}
                </span>
                <span className="mt-0.5 block break-words text-[12px] leading-snug text-zinc-400">
                  Charges the mandate the seller signed for Allbirds on behalf of the render credits
                  merchant. Prava refuses it with a 403 because that mandate names one merchant, and
                  the refusal appears right under this button with its reason. Nothing is spent. If
                  the Allbirds mandate is not signed yet, the agent says so instead of breaking.
                </span>
              </button>

              {manual && manual.slot === "charge" ? (
                <Note note={manual} onJump={jump} />
              ) : null}
            </div>
          </Fold>

          {hasAudit ? (
            <Reveal delay={60}>
              <Fold
                title="Audit log"
                hint={`Every call, every decision and every charge, newest first. ${
                  (state?.audit ?? []).length
                } ${(state?.audit ?? []).length === 1 ? "entry" : "entries"}.`}
              >
                <AuditLog entries={state?.audit ?? []} />
              </Fold>
            </Reveal>
          ) : null}

          {hasHistory ? (
            <Reveal delay={120}>
              <Fold
                title="Earlier runs"
                hint={`${history.length} ${
                  history.length === 1 ? "run" : "runs"
                } archived in this browser when a new product took the board. Open one, or pick two and compare the winning angles.`}
              >
                <RunHistory runs={history} />
              </Fold>
            </Reveal>
          ) : null}
        </Band>

        <p className="mx-auto mt-10 max-w-3xl break-words text-center text-[13px] leading-relaxed text-zinc-400 sm:mt-14">
          Impressions, clicks and click through rates on this page are simulated for the demo.
          Payments run against the Prava sandbox.
        </p>
      </main>

      <AgentChat state={state} />
    </div>
  );
}
