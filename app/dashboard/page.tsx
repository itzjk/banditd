"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  AuditEntry,
  Creative,
  CreativeAngle,
  Product,
  PurchaseEvent,
  Research,
  State,
} from "@/lib/store";
import MandateBar from "@/components/MandateBar";
import CreativeCard from "@/components/CreativeCard";
import PurchaseEventItem from "@/components/PurchaseEvent";
import AuditLog from "@/components/AuditLog";
import AgentStatus from "@/components/AgentStatus";
import PosteriorChart from "@/components/PosteriorChart";
import GatesPanel from "@/components/GatesPanel";
import LineageTree from "@/components/LineageTree";
import MarketPanel from "@/components/MarketPanel";
import DemoRunner, { AGENT_STEPS } from "@/components/DemoRunner";
import type { Decision, Evaluation, LastPurchase, Task } from "@/components/DemoRunner";
import { ctr, money, pct } from "@/components/format";

const MANDATE_CAP = 50;
const STORAGE_KEY = "banditd_state";
const ANGLES: CreativeAngle[] = ["price", "ritual", "gift", "quality"];
const MAX_AUDIT = 200;

const UNREADABLE =
  "A saved session in this browser could not be read, so it was discarded. You are starting clean.";
const PATCHED =
  "A saved session in this browser had damaged entries. They were dropped and the rest was restored.";

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

function safeProduct(value: unknown): Product | null {
  const p = record(value);
  if (!p || typeof p.name !== "string") return null;
  return { name: p.name, price: text(p.price), description: text(p.description) };
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

function sanitize(value: unknown): State | null {
  const raw = record(value);
  if (!raw) return null;
  return {
    product: safeProduct(raw.product),
    research: safeResearch(raw.research),
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
    mandateId: typeof raw.mandateId === "string" ? raw.mandateId : null,
    simulatedImpressions: count(raw.simulatedImpressions),
  };
}

function blank(): State {
  return {
    product: null,
    research: null,
    creatives: [],
    purchases: [],
    audit: [],
    mandateId: null,
    simulatedImpressions: 0,
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
    research: input.research,
    creatives,
    purchases: input.purchases,
    audit: input.audit,
    mandateId: input.mandateId,
    simulatedImpressions: input.simulatedImpressions,
  };
  return { clean, images };
}

function save(value: State) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    return;
  }
}

function forget() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
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
    throw new Error(message);
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
          ? "border-emerald-400/30 bg-emerald-400/[0.07] hover:bg-emerald-400/[0.12]"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.08]"
      } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/[0.03]`}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
        <span
          className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${
            done ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10 text-zinc-400"
          }`}
        >
          {index}
        </span>
        {running ? "Working" : label}
      </span>
      <span className="text-[11px] leading-snug text-zinc-400">{hint}</span>
    </button>
  );
}

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [images, setImages] = useState<Images>({});
  const [busy, setBusy] = useState<Task | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [receipt, setReceipt] = useState<LastPurchase | null>(null);
  const [impressions, setImpressions] = useState(1000);
  const [autoRunning, setAutoRunning] = useState(false);

  const absorb = useCallback((next: State) => {
    const { clean, images: found } = split(sanitize(next) ?? blank());
    setState(clean);
    if (Object.keys(found).length > 0) setImages((prev) => ({ ...prev, ...found }));
    save(clean);
    return clean;
  }, []);

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

  const winner = winnerId ? byId.get(winnerId) : undefined;
  const cohortImpressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const candidateImpressions = freshEvaluation
    ? (winner ?? cohort[freshEvaluation.candidateIndex])?.arm.impressions
    : undefined;

  const purchases = state?.purchases ?? [];
  const marketing = state?.research ?? null;
  const angles =
    marketing && Array.isArray(marketing.competitorAngles) ? marketing.competitorAngles : [];
  const sources = marketing && Array.isArray(marketing.sources) ? marketing.sources : [];

  const hasProduct = Boolean(state?.product);
  const hasResearch = Boolean(state?.research);
  const hasCreatives = cohort.length > 0;
  const hasTraffic = cohortImpressions > 0;
  const locked = busy !== null || autoRunning;

  const research = () =>
    run("research", async () => {
      absorb(await api<State>("/api/research", { state }));
    });

  const generate = (parentId?: string) => {
    if (locked) return;
    return run(parentId ? "evolve" : "creatives", async () => {
      absorb(await api<State>("/api/creatives", parentId ? { parentId, state } : { state }));
      setDecision(null);
      setEvaluation(null);
    });
  };

  const simulate = () =>
    run("simulate", async () => {
      absorb(await api<State>("/api/simulate", { impressions, state }));
    });

  const decide = () =>
    run("decide", async () => {
      const res = await api<DecideResponse>("/api/decide", { state });
      absorb(res.state);
      setDecision(res.decision);
      setEvaluation(res.evaluation);
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
    run("force", async () => {
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
    });

  return (
    <div className="min-h-screen bg-zinc-950 font-sans text-zinc-100">
      <MandateBar
        mandateId={state?.mandateId ?? null}
        cap={MANDATE_CAP}
        purchases={purchases}
        working={locked}
      />

      <main className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-20 pt-4 sm:space-y-6 sm:px-6 sm:pt-6">
        {notice ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-[12px] leading-snug text-amber-200">
            <span className="min-w-0">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-[11px] uppercase tracking-wider text-amber-300/80 hover:text-amber-100"
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

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
          {state?.product ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  Product under test
                </div>
                <h1 className="mt-1 break-words text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  {state.product.name}
                </h1>
                <p className="mt-1 max-w-2xl break-words text-[13px] leading-relaxed text-zinc-400">
                  {state.product.description}
                </p>
              </div>
              <div className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">Price</div>
                <div className="text-lg font-semibold tabular-nums text-white">
                  {state.product.price}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-2">
              <h1 className="text-lg font-semibold tracking-tight text-white">
                {busy === "load" ? "Loading the agent state" : "No product yet"}
              </h1>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                Submit a product on the home page and the agent takes it from there: research,
                creatives, traffic, and the spend decision.
              </p>
              <Link
                href="/"
                className="mt-3 inline-flex rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.1]"
              >
                Go submit a product
              </Link>
            </div>
          )}

          {state?.research ? (
            <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                  Who buys it
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
                  {state.research.buyerProfile}
                </p>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                  Competitor angles
                </div>
                <ul className="mt-1 space-y-1">
                  {angles.slice(0, 4).map((a) => (
                    <li key={a} className="text-[13px] leading-snug text-zinc-300">
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                  Price positioning
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
                  {state.research.pricePositioning}
                </p>
                {sources.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sources.slice(0, 4).map((s) => (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                      >
                        {s.title || s.url}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <DemoRunner
          state={state}
          absorb={absorb}
          impressions={impressions}
          disabled={busy !== null}
          running={autoRunning}
          onRunningChange={setAutoRunning}
          onDecision={carryDecision}
          onReceipt={setReceipt}
        />

        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              Or run it step by step
            </h2>
            <span className="text-[11px] text-zinc-400">Generation {generation}</span>
          </div>

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

          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-amber-400/20 text-[10px] font-bold text-amber-300">
                    3
                  </span>
                  <h3 className="text-[15px] font-semibold text-white">Simulate traffic</h3>
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    Simulated
                  </span>
                </div>
                <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-zinc-400">
                  Fire it yourself. Impressions are allocated by Thompson sampling and clicks come
                  from a hidden rate per creative. These numbers are generated, not real ad data.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[500, 1000, 5000].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setImpressions(n)}
                      className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold tabular-nums transition-colors ${
                        impressions === n
                          ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
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
                className="w-full shrink-0 rounded-xl bg-amber-400 px-5 py-3 text-[15px] font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                {busy === "simulate"
                  ? "Serving impressions"
                  : `Serve ${impressions.toLocaleString()} impressions`}
              </button>
            </div>
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
            <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">
              Fires a charge ten times the ceiling on purpose. The mandate refuses it and the
              rejection lands below with its reason. Nothing is spent.
            </span>
          </button>
        </section>

        {busy && busy !== "load" ? (
          <AgentStatus title={AGENT_STEPS[busy].title} steps={AGENT_STEPS[busy].steps} />
        ) : null}

        {receipt ? (
          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-[13px] ${
              receipt.ok
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                : "border-rose-400/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            <span className="min-w-0">
              {receipt.ok
                ? `Charged $${money(receipt.amount)} on a single use card ending ${receipt.cardLast4 ?? "????"}.`
                : `Blocked at $${money(receipt.amount)}: ${receipt.errorCode ?? "declined"}. Nothing was spent.`}
            </span>
            <button
              type="button"
              onClick={() => setReceipt(null)}
              className="text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {decision && freshEvaluation ? (
          <section
            className={`rounded-2xl border p-3 sm:p-4 ${
              decision.shouldBuy
                ? "border-emerald-400/40 bg-emerald-400/[0.06]"
                : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
                  decision.shouldBuy
                    ? "bg-emerald-400/20 text-emerald-300"
                    : "bg-white/10 text-zinc-400"
                }`}
              >
                {decision.shouldBuy ? "Spending" : "Holding"}
              </span>
              <h2 className="text-[15px] font-semibold text-white">
                {decision.shouldBuy
                  ? `The agent wants to spend $${money(decision.amount)}`
                  : "The agent kept the money in its pocket"}
              </h2>
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Decided on simulated traffic
              </span>
            </div>

            <p className="mt-2 text-[13px] leading-relaxed text-zinc-200">
              {decision.shouldBuy ? decision.reason : (decision.abstainedBecause ?? decision.reason)}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                  Probability best
                  <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                    Sim
                  </span>
                </div>
                <div className="text-sm font-semibold tabular-nums text-zinc-100">
                  {pct(freshEvaluation.probabilityBest)}
                </div>
              </div>
              <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                  Evidence
                </div>
                <div
                  className={`text-sm font-semibold ${
                    freshEvaluation.sufficientEvidence ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  {freshEvaluation.sufficientEvidence ? "Enough" : "Not yet"}
                </div>
              </div>
              <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                  Impressions
                  <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                    Sim
                  </span>
                </div>
                <div className="text-sm font-semibold tabular-nums text-zinc-100">
                  {freshEvaluation.totalImpressions.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                  Candidate
                </div>
                <div className="truncate text-sm font-semibold text-zinc-100">
                  {winner ? winner.angle : "none"}
                </div>
              </div>
            </div>

            {decision.shouldBuy ? (
              <button
                type="button"
                onClick={purchase}
                disabled={locked}
                className="mt-3 w-full rounded-xl bg-emerald-400 px-4 py-3 text-[15px] font-bold text-zinc-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "purchase"
                  ? "Charging the mandate"
                  : `Let it spend $${money(decision.amount)}`}
              </button>
            ) : null}
          </section>
        ) : null}

        <PosteriorChart
          creatives={cohort}
          winnerIndex={winnerId ? cohort.findIndex((c) => c.id === winnerId) : null}
        />

        <GatesPanel
          evaluation={freshEvaluation}
          candidateImpressions={candidateImpressions}
          candidateLabel={cohort.find((c) => c.id === winnerId)?.headline}
        />

        <LineageTree
          creatives={state?.creatives ?? []}
          winnerId={winnerId}
          purchases={purchases}
        />

        <MarketPanel research={state?.research ?? null} productName={state?.product?.name} />

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-white">
              Creatives in the run
            </h2>
            <span className="text-[11px] text-zinc-400">
              {cohort.length} live in generation {generation}, {cohortImpressions.toLocaleString()}{" "}
              simulated impressions
            </span>
          </div>

          {hasCreatives ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {cohort.map((c, i) => (
                <CreativeCard
                  key={c.id}
                  index={i}
                  creative={dressed(c)}
                  isWinner={c.id === winnerId}
                  isLeader={c.id !== winnerId && c.id === leaderId}
                  probabilityBest={freshEvaluation?.probabilityBest ?? null}
                  bestCtr={bestCtr}
                  parentHeadline={c.parentId ? (byId.get(c.parentId)?.headline ?? null) : null}
                  onEvolve={generate}
                  evolving={busy === "evolve"}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] p-6 text-center">
              <p className="text-[13px] text-zinc-400">
                No creatives yet. Run the research, then let the agent write four.
              </p>
            </div>
          )}

          {creatives.length > cohort.length ? (
            <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-zinc-400">
                Retired variants from earlier generations ({creatives.length - cohort.length})
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {creatives
                  .filter((c) => c.generation !== generation)
                  .map((c) => (
                    <CreativeCard
                      key={c.id}
                      creative={dressed(c)}
                      retired
                      bestCtr={bestCtr}
                      parentHeadline={c.parentId ? (byId.get(c.parentId)?.headline ?? null) : null}
                    />
                  ))}
              </div>
            </details>
          ) : null}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-white">Money it moved</h2>
            <span className="text-[11px] text-zinc-400">
              Sandbox payments, single use cards, newest first. The impressions and confidence on
              each charge come from simulated traffic.
            </span>
          </div>

          {purchases.length ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {purchases.map((p, i) => (
                <PurchaseEventItem
                  key={p.id}
                  event={p}
                  latest={i === 0}
                  winnerHeadline={byId.get(p.winnerId)?.headline ?? null}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] p-6 text-center">
              <p className="text-[13px] text-zinc-400">
                Nothing charged yet. Every attempt shows up here, the ones that go through and the
                ones the mandate refuses.
              </p>
            </div>
          )}
        </section>

        <AuditLog entries={state?.audit ?? []} />

        <p className="pb-2 text-center text-[13px] leading-relaxed text-zinc-300">
          Impressions, clicks and click through rates on this page are simulated for the demo.
          Payments run against the Prava sandbox.
        </p>
      </main>
    </div>
  );
}
