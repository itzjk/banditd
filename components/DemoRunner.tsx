"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Creative, State } from "@/lib/store";
import { evaluate } from "@/lib/bandit";
import { claimAutorun } from "@/lib/autorun";
import { declineFamily, type DeclineFamily } from "@/lib/declines";
import { ACTION_LABEL, MAX_PLAN_CYCLES } from "@/lib/plan";
import type { PlanAction, PlanChoice } from "@/lib/plan";
import AgentStatus from "@/components/AgentStatus";
import { ctr, money, pct, plain, strength } from "@/components/format";

export type Task =
  | "load"
  | "plan"
  | "research"
  | "creatives"
  | "evolve"
  | "simulate"
  | "decide"
  | "purchase"
  | "force"
  | "scope"
  | "revoke";

export interface Decision {
  shouldBuy: boolean;
  amount: string | null;
  reason: string;
  abstainedBecause: string | null;
  trafficPlan?: { targetImpressions: number; reason: string } | null;
}

export interface Evaluation {
  candidateIndex: number;
  probabilityBest: number;
  sufficientEvidence: boolean;
  totalImpressions: number;
  generation?: number;
  candidateId?: string | null;
  expectedLoss?: number;
  eValue?: number;
  posteriorMean?: number;
  thresholdMet?: boolean;
  minImpressionsMet?: boolean;
  effectSizeOk?: boolean;
  anytimeValid?: boolean;
}

export interface LastPurchase {
  ok: boolean;
  amount: string;
  reason: string;
  errorCode?: string;
  family?: DeclineFamily;
  message?: string;
  forced?: boolean;
  cardLast4?: string | null;
  creditedRenders?: number;
}

interface DecideResponse {
  decision: Decision;
  evaluation: Evaluation;
  state: State;
}

type PurchaseResponse = State & { lastPurchase?: LastPurchase };

export const AGENT_STEPS: Record<Task, { title: string; steps: string[] }> = {
  load: { title: "Waking up", steps: ["Reading the agent state"] },
  plan: {
    title: "Choosing what to do next",
    steps: [
      "Reading what is already done in this run",
      "Reading the four gates on the live cohort",
      "Reading what the signed mandate still allows",
      "Picking one action and saying why",
    ],
  },
  research: {
    title: "Researching the market",
    steps: [
      "Searching the web for who buys this",
      "Reading the angles competitors run",
      "Placing the price against comparable products",
      "Writing the buyer profile",
    ],
  },
  creatives: {
    title: "Writing creatives",
    steps: [
      "Picking 4 angles out of the research",
      "Writing headlines and body copy",
      "Sending 4 image prompts to render",
      "Loading every variant into the bandit",
    ],
  },
  evolve: {
    title: "Breeding the winner",
    steps: [
      "Taking the winning creative apart",
      "Writing 4 mutations of that angle",
      "Sending the new image prompts to render",
      "Opening generation two",
    ],
  },
  simulate: {
    title: "Serving traffic",
    steps: [
      "Opening the simulated auction",
      "Allocating impressions by Thompson sampling",
      "Counting clicks per variant",
      "Re-reading the frontier after every round",
    ],
  },
  decide: {
    title: "Deciding whether to spend",
    steps: [
      "Drawing 20,000 samples from every posterior",
      "Ranking the variants by probability best",
      "Reading the mandate limits",
      "Asking the model to justify the spend",
    ],
  },
  purchase: {
    title: "Buying render credits",
    steps: [
      "Minting a single use card",
      "Charging the mandate",
      "Reporting the charge back to Prava",
      "Crediting the renders the charge paid for",
    ],
  },
  force: {
    title: "Testing the guardrail",
    steps: [
      "Building a charge above the signed ceiling",
      "Sending it at the mandate on purpose",
      "Waiting for the refusal",
    ],
  },
  scope: {
    title: "Testing the merchant lock",
    steps: [
      "Finding the mandate signed for Allbirds",
      "Charging it for the render credits merchant on purpose",
      "Waiting for the refusal",
    ],
  },
  revoke: {
    title: "Revoking the mandate",
    steps: [
      "Telling Prava to cancel the authorization",
      "Confirming nothing can be charged anymore",
    ],
  },
};

const TIMEOUT: Record<string, number> = {
  research: 240000,
  creatives: 300000,
  simulate: 60000,
  decide: 240000,
  purchase: 120000,
  plan: 90000,
};

const TOTAL_STEPS = 7;
const PATIENCE_AFTER = 20;

const AUTONOMOUS = process.env.NEXT_PUBLIC_AGENT_PLANNER === "1";
const SOFT_FALLBACKS = 2;
const MAX_PURCHASE_ATTEMPTS = 2;
const MAX_WRITES = 2;
const MAX_BREEDS = 2;

const MAX_ROUNDS = 12;
const MAX_DECISIONS = 2;
const ROUND_GROWTH = 1.8;
const ROUND_CEILING = 400000;
const ROUND_SAMPLES = 20000;
export const EVIDENCE_TARGET = 20;

const CYCLE_BLOCKS = new Set(["NO_MANDATE_AVAILABLE", "CYCLE_ALREADY_CHARGED"]);

type Tone = "done" | "held" | "blocked" | "stalled";
type Status = "running" | Tone | "failed" | "cancelled";

interface Entry {
  id: string;
  task: Task;
  label: string;
  status: Status;
  detail: string;
  note?: string;
  startedAt: number;
  seconds?: number;
}

interface Round {
  n: number;
  impressions: number;
  probabilityBest: number;
  eValue: number;
  gate: string | null;
  cleared: boolean;
}

type Report = (patch: { detail?: string; note?: string }) => void;

interface PlanResponse {
  choice: PlanChoice;
  source: "model" | "fallback";
  fallbackBecause: string | null;
  tookMs: number;
  state?: State;
}

interface PlanShown {
  cycle: number;
  action: PlanAction;
  reason: string;
  source: "model" | "fallback";
  impressions: number | null;
}

type EndingKind = "complete" | "held" | "blocked" | "stalled" | "failed" | "stopped";

interface Ending {
  kind: EndingKind;
  headline: string;
  text: string;
}

class Cancelled extends Error {}

const LEDGER_IS_THE_RECORD =
  "The payment ledger and the audit log are the record of whether money moved, not this screen. Read the ledger before firing another charge.";

function offlineText(label: string, money: boolean): string {
  if (money) {
    return `${label} never reached the server: the browser lost its connection while the charge was in flight, so this screen cannot say whether the charge went out. No rule on the mandate refused anything. ${LEDGER_IS_THE_RECORD}`;
  }
  return `${label} never reached the server: the browser lost its connection mid request. This step never charges anything, so nothing was spent. Check the connection and fire the step again from the manual controls below.`;
}

function unreadableText(status: number, label: string, money: boolean): string {
  if (money) {
    return `${label} came back as HTTP ${status} with no answer this page could read. That is the request being dropped on the way, not a rule on the mandate refusing the spend, and whether Prava completed the charge cannot be told from here. ${LEDGER_IS_THE_RECORD}`;
  }
  return `${label} came back as HTTP ${status} with no answer this page could read. That is the server failing rather than the agent refusing anything, and nothing was spent. Fire the step again from the manual controls below.`;
}

function timedOutText(label: string, ms: number, money: boolean): string {
  const seconds = Math.round(ms / 1000);
  if (money) {
    return `${label} ran past ${seconds} seconds without answering. The charge may still be finishing on the server, so this screen cannot say whether it went out, and no rule on the mandate refused it. ${LEDGER_IS_THE_RECORD}`;
  }
  return `${label} ran past ${seconds} seconds without answering. The server may still be finishing it, wait a moment and fire that step by hand from the manual controls.`;
}

interface Props {
  state: State | null;
  absorb: (next: State) => State;
  impressions: number;
  disabled: boolean;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onDecision: (decision: Decision | null, evaluation: Evaluation | null) => void;
  onReceipt: (receipt: LastPurchase | null) => void;
  footer?: ReactNode;
}

function cohortOf(input: State): Creative[] {
  if (input.creatives.length === 0) return [];
  const generation = Math.max(...input.creatives.map((c) => c.generation));
  return input.creatives.filter((c) => c.generation === generation);
}

function bestCtrOf(cohort: Creative[]): number {
  return cohort.reduce((max, c) => Math.max(max, ctr(c.arm.impressions, c.arm.clicks)), 0);
}

function leaderOf(cohort: Creative[]): Creative | null {
  const scored = cohort.filter((c) => c.arm.impressions > 0);
  if (scored.length === 0) return cohort[0] ?? null;
  return scored.reduce((best, c) =>
    ctr(c.arm.impressions, c.arm.clicks) > ctr(best.arm.impressions, best.arm.clicks) ? c : best,
  );
}

function roundSize(base: number, round: number): number {
  return Math.min(ROUND_CEILING, Math.round(base * Math.pow(ROUND_GROWTH, round - 1)));
}

function times(value: number): string {
  if (!Number.isFinite(value)) return "off the scale";
  if (value >= 1000) {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 0 }).format(
      value,
    );
  }
  return value.toFixed(1);
}

function evidenceFill(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value <= 0) return 0;
  if (value >= EVIDENCE_TARGET) return 1;
  return Math.max(0.02, Math.log10(1 + value) / Math.log10(1 + EVIDENCE_TARGET));
}

function look(cohort: Creative[]): Evaluation {
  const result = evaluate(
    cohort.map((c) => c.arm),
    { samples: ROUND_SAMPLES, candidateRule: "probabilityBest" },
  );
  return {
    ...result,
    generation: cohort[0]?.generation ?? 0,
    candidateId: cohort[result.candidateIndex]?.id ?? null,
  };
}

function looksWord(n: number): string {
  return n === 1 ? "1 look" : `${n} looks`;
}

function gatesCleared(evaluation: Evaluation | null): boolean {
  return evaluation?.sufficientEvidence === true;
}

function blockingGate(evaluation: Evaluation): string | null {
  if (evaluation.minImpressionsMet === false) return "Enough traffic";
  if (evaluation.thresholdMet === false) return "One ad clearly ahead";
  if (evaluation.effectSizeOk === false) return "The gap is worth money";
  if (evaluation.anytimeValid === false) return "Holds up to repeated looks";
  return null;
}

function roundLine(row: Round): string {
  return `Look ${row.n}: ${row.impressions.toLocaleString()} impressions, ${pct(
    row.probabilityBest,
  )} probability best, evidence ${strength(row.eValue)} of ${EVIDENCE_TARGET}`;
}

function RoundTrack({ rounds }: { rounds: Round[] }) {
  const latest = rounds[rounds.length - 1] ?? null;
  const previous = rounds.length > 1 ? rounds[rounds.length - 2] : null;

  if (!latest) return null;

  const factor =
    previous && previous.eValue > 0 && Number.isFinite(latest.eValue)
      ? latest.eValue / previous.eValue
      : null;
  const climbing = factor !== null && factor >= 1;
  const move =
    factor === null
      ? "first look"
      : climbing
        ? `up ${times(factor)}x this look`
        : factor > 0
          ? `down ${times(1 / factor)}x this look`
          : "back to nothing this look";

  return (
    <div className="border-t border-white/10 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Anytime valid frontier
        </span>
        <span className="text-[12px] tabular-nums text-zinc-400">
          Look {latest.n} of {MAX_ROUNDS}
        </span>
      </div>

      <div className="mt-2 rounded-xl bg-white/[0.03] p-3">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              Evidence strength
            </div>
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span
                className={`text-2xl font-semibold tabular-nums sm:text-3xl ${
                  latest.eValue >= EVIDENCE_TARGET ? "text-white" : "text-zinc-400"
                }`}
              >
                {strength(latest.eValue)}
              </span>
              <span className="text-[12px] text-zinc-400">of {EVIDENCE_TARGET} needed</span>
            </div>
          </div>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
              climbing
                ? "border-white/25 bg-white/10 text-zinc-100"
                : "border-white/15 bg-white/5 text-zinc-400"
            }`}
          >
            {move}
          </span>
        </div>

        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`bar-fill h-full w-full ${
              latest.eValue >= EVIDENCE_TARGET ? "bg-white" : "bg-zinc-500"
            }`}
            style={{ transform: `scaleX(${evidenceFill(latest.eValue)})` }}
          />
        </div>

        <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
          Every round is another look at the same test. Only new traffic moves this number, which is
          what makes looking again and again safe.
        </p>
      </div>

      <div className="mt-2 overflow-hidden rounded-xl">
        <div className="grid grid-cols-[1.6rem_1fr_3rem_3.4rem] gap-1 border-b border-white/10 bg-white/[0.03] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          <span>Rd</span>
          <span>Impressions</span>
          <span className="text-right">Best</span>
          <span className="text-right">E value</span>
        </div>
        <ul className="divide-y divide-white/5">
          {rounds.map((row) => (
            <li
              key={row.n}
              className="enter-soft grid grid-cols-[1.6rem_1fr_3rem_3.4rem] items-baseline gap-1 px-2 py-2 text-[12px] tabular-nums"
            >
              <span className="text-zinc-400">{row.n}</span>
              <span className="text-zinc-300">{row.impressions.toLocaleString()}</span>
              <span className="text-right text-zinc-300">{pct(row.probabilityBest, 0)}</span>
              <span
                className={`text-right font-semibold ${
                  row.eValue >= EVIDENCE_TARGET ? "text-white" : "text-zinc-400"
                }`}
              >
                {strength(row.eValue)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p
        className={`mt-2 text-[12px] leading-relaxed ${
          latest.cleared ? "text-zinc-100" : "text-zinc-400"
        }`}
      >
        {latest.cleared
          ? `All four gates cleared on look ${latest.n}.`
          : `Still waiting on: ${latest.gate ?? "one more check"}. Serving more traffic.`}
      </p>
    </div>
  );
}

function PlanTrack({ plans }: { plans: PlanShown[] }) {
  const latest = plans[plans.length - 1] ?? null;
  if (!latest) return null;
  const earlier = plans.slice(0, -1).reverse();

  return (
    <div className="border-t border-white/10 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Why the agent picked this step
        </span>
        <span className="text-[12px] tabular-nums text-zinc-400">
          Cycle {latest.cycle} of {MAX_PLAN_CYCLES}
        </span>
      </div>

      <div className="mt-2 rounded-xl bg-white/[0.03] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-950">
            {ACTION_LABEL[latest.action]}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
              latest.source === "model"
                ? "border-white/25 bg-white/10 text-zinc-100"
                : "border-amber-400/50 bg-amber-400/10 text-amber-200"
            }`}
          >
            {latest.source === "model" ? "chosen by the model" : "fell back to the script"}
          </span>
          {latest.impressions ? (
            <span className="text-[12px] tabular-nums text-zinc-400">
              {latest.impressions.toLocaleString()} impressions
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-200">{latest.reason}</p>
      </div>

      {earlier.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {earlier.map((plan) => (
            <li
              key={plan.cycle}
              className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Cycle {plan.cycle}
                </span>
                <span className="text-[12px] font-semibold text-zinc-200">
                  {ACTION_LABEL[plan.action]}
                </span>
                {plan.source === "fallback" ? (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                    script
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{plan.reason}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
        Nothing here is a fixed order. Every cycle the agent reads the state of the run, the four
        gates and what the mandate still allows, then picks one action out of seven and says why. The
        limits do not move: the purchase route recomputes the gates on the server and Prava enforces
        the mandate, whatever the agent asks for.
      </p>
    </div>
  );
}

const STATUS_WORD: Record<Status, string> = {
  running: "Running",
  done: "Done",
  held: "Held",
  stalled: "Stalled",
  blocked: "Blocked",
  failed: "Failed",
  cancelled: "Cancelled",
};

function StatusDot({ status }: { status: Status }) {
  const word = <span className="sr-only">{STATUS_WORD[status] ?? status}, </span>;

  if (status === "running") {
    return (
      <span className="relative mt-0.5 flex h-3 w-3 shrink-0">
        {word}
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-300 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-zinc-200" />
      </span>
    );
  }

  const tone =
    status === "done"
      ? "border-white/40 bg-white/20 text-white"
      : status === "held"
        ? "border-white/20 bg-white/10 text-zinc-300"
        : status === "stalled"
          ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
          : status === "blocked" || status === "failed"
            ? "border-rose-400/50 bg-rose-500/20 text-rose-300"
            : "border-white/15 bg-white/10 text-zinc-500";

  return (
    <span
      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${tone}`}
    >
      {word}
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-2.5 w-2.5">
        {status === "done" ? (
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M4 8h8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}

function TimelineRow({ entry }: { entry: Entry }) {
  const title =
    entry.status === "done"
      ? "text-zinc-100"
      : entry.status === "running"
        ? "text-white"
        : entry.status === "held"
          ? "text-zinc-200"
          : entry.status === "stalled"
            ? "text-amber-100"
            : entry.status === "blocked" || entry.status === "failed"
              ? "text-rose-100"
              : "text-zinc-400";

  return (
    <li className="flex gap-2.5 px-3 py-2 sm:px-4">
      <StatusDot status={entry.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-[14px] font-semibold ${title}`}>{entry.label}</span>
          {typeof entry.seconds === "number" ? (
            <span className="text-[10px] tabular-nums text-zinc-400">{entry.seconds}s</span>
          ) : null}
        </div>
        {entry.detail ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{entry.detail}</p>
        ) : null}
        {entry.note ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{entry.note}</p>
        ) : null}
      </div>
    </li>
  );
}

export default function DemoRunner({
  state,
  absorb,
  impressions,
  disabled,
  running,
  onRunningChange,
  onDecision,
  onReceipt,
  footer,
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [plans, setPlans] = useState<PlanShown[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [waited, setWaited] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const seqRef = useRef(0);

  const active = entries.find((e) => e.status === "running") ?? null;
  const activeId = active?.id ?? null;

  useEffect(() => {
    if (!activeId) {
      setWaited(0);
      return;
    }
    setWaited(0);
    const timer = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(timer);
  }, [activeId]);

  const call = useCallback(
    async <T,>(
      url: string,
      body: unknown,
      ms: number,
      label: string,
      money = false,
    ): Promise<T> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        controller.abort();
      }, ms);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: controller.signal,
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const said =
            data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : null;
          throw new Error(said ?? unreadableText(res.status, label, money));
        }
        return data as T;
      } catch (e) {
        if (cancelledRef.current) throw new Cancelled();
        if (expired) throw new Error(timedOutText(label, ms, money));
        if (e instanceof TypeError) throw new Error(offlineText(label, money));
        throw e instanceof Error ? e : new Error(offlineText(label, money));
      } finally {
        clearTimeout(timer);
        controllerRef.current = null;
      }
    },
    [],
  );

  const callRaw = useCallback(
    async (
      url: string,
      body: unknown,
      ms: number,
      label: string,
      money = false,
    ): Promise<{ ok: boolean; status: number; data: unknown }> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        controller.abort();
      }, ms);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: controller.signal,
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok && data === null) {
          throw new Error(unreadableText(res.status, label, money));
        }
        return { ok: res.ok, status: res.status, data };
      } catch (e) {
        if (cancelledRef.current) throw new Cancelled();
        if (expired) throw new Error(timedOutText(label, ms, money));
        if (e instanceof TypeError) throw new Error(offlineText(label, money));
        throw e instanceof Error ? e : new Error(offlineText(label, money));
      } finally {
        clearTimeout(timer);
        controllerRef.current = null;
      }
    },
    [],
  );

  const step = useCallback(
    async (
      task: Task,
      label: string,
      work: (report: Report) => Promise<{ detail: string; note?: string; tone?: Tone }>,
    ) => {
      seqRef.current += 1;
      const id = `step_${seqRef.current}`;
      const startedAt = Date.now();
      setEntries((prev) => [...prev, { id, task, label, status: "running", detail: "", startedAt }]);

      const report: Report = (patch) =>
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

      try {
        const out = await work(report);
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  status: out.tone ?? "done",
                  detail: out.detail,
                  note: out.note,
                  seconds: Math.round((Date.now() - startedAt) / 1000),
                }
              : e,
          ),
        );
      } catch (err) {
        const stopped = err instanceof Cancelled;
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  status: stopped ? "cancelled" : "failed",
                  detail: stopped
                    ? "Stopped by hand before this step came back"
                    : err instanceof Error
                      ? err.message
                      : "This step failed and gave no reason",
                  seconds: Math.round((Date.now() - startedAt) / 1000),
                }
              : e,
          ),
        );
        throw err;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    controllerRef.current?.abort();
  }, []);

  const start = useCallback(async () => {
    if (!state?.product) return;

    cancelledRef.current = false;
    setEntries([]);
    setRounds([]);
    setPlans([]);
    setEnding(null);
    onReceipt(null);
    onRunningChange(true);

    const guard = () => {
      if (cancelledRef.current) throw new Cancelled();
    };

    const held: {
      current: State;
      decision: Decision | null;
      evaluation: Evaluation | null;
      gate: string | null;
      bought: boolean;
      declined: string | null;
      family: DeclineFamily;
      round: number;
      opened: boolean;
      parentCtr: number;
      plan: { targetImpressions: number; reason: string } | null;
      naiveLook: number | null;
      researched: boolean;
      wrote: boolean;
      writes: number;
      decided: boolean;
      purchaseAttempts: number;
      evolved: boolean;
      breeds: number;
      retested: boolean;
      lastPurchaseNote: string | null;
      history: string[];
    } = {
      current: state,
      decision: null,
      evaluation: null,
      gate: null,
      bought: false,
      declined: null,
      family: "unknown",
      round: 0,
      opened: false,
      parentCtr: 0,
      plan: null,
      naiveLook: null,
      researched: false,
      wrote: false,
      writes: 0,
      decided: false,
      purchaseAttempts: 0,
      evolved: false,
      breeds: 0,
      retested: false,
      lastPurchaseNote: null,
      history: [],
    };

    const note = (line: string) => {
      held.history.push(line);
    };

    const cohortImpressions = () =>
      cohortOf(held.current).reduce((sum, c) => sum + c.arm.impressions, 0);

    const serve = async (label: string) => {
      await step("simulate", label, async (report) => {
        let last: Round | null = null;
        held.opened = false;

        while (held.round < MAX_ROUNDS) {
          held.round += 1;
          let size = roundSize(impressions, held.round);
          if (held.plan) {
            const total = cohortOf(held.current).reduce((sum, c) => sum + c.arm.impressions, 0);
            const gap = held.plan.targetImpressions - total;
            if (gap > 0) {
              size = Math.min(ROUND_CEILING, gap);
            } else {
              held.plan = null;
            }
          }
          const next = await call<State>(
            "/api/simulate",
            { impressions: size, state: held.current },
            TIMEOUT.simulate,
            "The traffic simulation",
          );
          held.current = absorb(next);

          const cohort = cohortOf(held.current);
          const evaluation = look(cohort);
          held.evaluation = evaluation;
          onDecision(null, evaluation);

          const row: Round = {
            n: held.round,
            impressions: cohort.reduce((sum, c) => sum + c.arm.impressions, 0),
            probabilityBest: evaluation.probabilityBest,
            eValue: evaluation.eValue ?? 0,
            gate: blockingGate(evaluation),
            cleared: evaluation.sufficientEvidence,
          };
          last = row;
          setRounds((prev) => [...prev, row]);
          report({ detail: roundLine(row) });

          if (
            held.naiveLook === null &&
            evaluation.thresholdMet === true &&
            !evaluation.sufficientEvidence
          ) {
            held.naiveLook = held.round;
            report({
              note: `Look ${held.round}: probability best crossed the bar with the gates still shut. The fixed-horizon rule the industry uses would have bought right here. banditd kept testing.`,
            });
          }

          if (evaluation.sufficientEvidence) {
            held.opened = true;
            break;
          }

          if (held.plan && row.impressions >= held.plan.targetImpressions) {
            held.plan = null;
            break;
          }

          guard();
        }

        if (!last) throw new Error("The run was already out of looks before this traffic step");

        held.decided = false;

        if (held.opened) {
          note(
            `served traffic to look ${last.n}, ${last.impressions} impressions on the board, all four gates opened`,
          );
          return {
            detail: `Gates opened on look ${last.n} with ${last.impressions.toLocaleString()} impressions served, evidence ${strength(
              last.eValue,
            )} against the ${EVIDENCE_TARGET} needed`,
            note: `Probability best reached ${pct(
              last.probabilityBest,
            )} and the frontier held across ${looksWord(last.n)} at the same test${
              held.naiveLook !== null && held.naiveLook < last.n
                ? `. The fixed-horizon rule the industry uses would have bought back on look ${held.naiveLook}`
                : ""
            }`,
          };
        }

        note(
          `served traffic to look ${last.n}, ${last.impressions} impressions on the board, still shut on "${last.gate ?? "one check"}"`,
        );

        return {
          tone: "held" as Tone,
          detail: `Served ${last.impressions.toLocaleString()} impressions across ${looksWord(
            last.n,
          )} and the evidence stalled at ${strength(last.eValue)} of ${EVIDENCE_TARGET}`,
          note: last.gate ? `The gate still holding the money: ${last.gate}.` : undefined,
        };
      });
    };

    const settle = async (label: string) => {
      await step("decide", label, async () => {
        const res = await call<DecideResponse>(
          "/api/decide",
          { state: held.current },
          TIMEOUT.decide,
          "The spend decision",
        );
        held.current = absorb(res.state);
        held.decision = res.decision;
        held.evaluation = res.evaluation;
        held.decided = true;
        onDecision(res.decision, res.evaluation);

        if (res.decision.shouldBuy) {
          note(`read the evidence and cleared a spend of ${res.decision.amount}`);
          return {
            detail: `Cleared to spend $${money(res.decision.amount)} at ${pct(
              res.evaluation.probabilityBest,
            )} probability best over ${res.evaluation.totalImpressions.toLocaleString()} impressions`,
            note: plain(res.decision.reason),
          };
        }

        const plan = res.decision.trafficPlan ?? null;
        held.plan = plan;
        const cleared = gatesCleared(res.evaluation);
        held.gate = cleared ? null : blockingGate(res.evaluation);
        if (plan) {
          note(
            `read the evidence and held the money, asking for ${plan.targetImpressions} impressions before looking again`,
          );
          return {
            tone: "held" as Tone,
            detail: `Held the money and set its own target: ${plan.targetImpressions.toLocaleString()} impressions on the board before it reads the evidence again`,
            note: plain(plan.reason),
          };
        }
        note(`read the evidence and held the money${held.gate ? `, blocked on "${held.gate}"` : ""}`);
        return {
          tone: "held" as Tone,
          detail: cleared
            ? "Held the money. All four gates cleared, so the evidence is not what stopped it: the block is on the mandate."
            : held.gate
              ? `Held the money. The gate that stopped it: ${held.gate}.`
              : "Held the money. The evidence never cleared the gates.",
          note: plain(res.decision.abstainedBecause ?? res.decision.reason),
        };
      });
    };

    const doResearch = async () => {
      await step("research", "Research the market", async () => {
        const next = await call<State>(
          "/api/research",
          { state: held.current },
          TIMEOUT.research,
          "The market research",
        );
        held.current = absorb(next);
        held.researched = true;
        const sources = held.current.research?.sources.length ?? 0;
        note(`researched the market off ${sources} live sources`);
        return {
          detail: sources
            ? `Read ${sources} live sources and wrote the buyer profile`
            : "Wrote the buyer profile off the live search",
        };
      });
    };

    const doCreatives = async () => {
      await step("creatives", "Write four creatives", async () => {
        const next = await call<State>(
          "/api/creatives",
          { state: held.current },
          TIMEOUT.creatives,
          "The creative generation",
        );
        held.current = absorb(next);
        held.wrote = true;
        held.writes += 1;
        held.decided = false;
        const cohort = cohortOf(held.current);
        note(`wrote ${cohort.length} creatives into generation ${cohort[0]?.generation ?? 0}`);
        return {
          detail: `Wrote ${cohort.length} ads: ${cohort.map((c) => c.angle).join(", ")}`,
          note: "The images render one per request and land on the cards as they arrive",
        };
      });
    };

    const attemptPurchase = async (label: string, tolerant: boolean) => {
      await step("purchase", label, async () => {
        const cohort = cohortOf(held.current);
        held.purchaseAttempts += 1;
        const payload = {
          amount: held.decision?.amount ?? "4.00",
          reason: held.decision?.reason ?? "The agent chose to buy render credits at this point in the run",
          winnerId: held.evaluation?.candidateId ?? cohort[0]?.id,
          probabilityBest: held.evaluation?.probabilityBest ?? 0,
          impressions: cohort.reduce((sum, c) => sum + c.arm.impressions, 0),
          state: held.current,
        };

        if (tolerant) {
          const raw = await callRaw("/api/purchase", payload, TIMEOUT.purchase, "The purchase", true);
          if (!raw.ok) {
            const data = (raw.data ?? {}) as { error?: unknown; code?: unknown; state?: unknown };
            const code = typeof data.code === "string" ? data.code : `HTTP ${raw.status}`;
            const said =
              typeof data.error === "string"
                ? data.error
                : "The server refused the charge and gave no reason this page could read.";
            held.lastPurchaseNote = `refused by the server before any mandate was touched, code ${code}`;
            note(`asked to buy and the server refused it: ${code}`);
            return {
              tone: "blocked" as Tone,
              detail: `The server refused the charge before any mandate was touched: ${code}. Nothing was spent.`,
              note: said,
            };
          }
          return readPurchase(raw.data as PurchaseResponse);
        }

        const res = await call<PurchaseResponse>(
          "/api/purchase",
          payload,
          TIMEOUT.purchase,
          "The purchase",
          true,
        );
        return readPurchase(res);
      });
    };

    const readPurchase = (res: PurchaseResponse) => {
      held.current = absorb(res);
      onReceipt(res.lastPurchase ?? null);
      held.bought = res.lastPurchase?.ok === true;

      if (held.bought) {
        const credited = res.lastPurchase?.creditedRenders ?? 0;
        held.lastPurchaseNote = `charged ${res.lastPurchase?.amount} and delivered ${credited} render credits`;
        note(`charged the mandate for ${res.lastPurchase?.amount} and got ${credited} render credits`);
        return {
          detail: `Charged $${money(res.lastPurchase?.amount)} on a single use card ending ${
            res.lastPurchase?.cardLast4 ?? "????"
          }${credited ? `, delivering ${credited} render credits the next generation burns one by one` : ""}`,
          note:
            held.naiveLook !== null
              ? `The fixed-horizon rule the industry uses would have bought at look ${held.naiveLook}. banditd waited until look ${held.round}, when the evidence survived repeated looks.`
              : undefined,
        };
      }

      const code = res.lastPurchase?.errorCode ?? null;
      held.declined = code;
      held.family = res.lastPurchase?.family ?? declineFamily(code);
      const shown = code ?? "no code returned";
      held.lastPurchaseNote = `the mandate did not pay, code ${shown}`;
      note(`the charge did not go through, code ${shown}`);

      if (held.family === "guardrail") {
        return {
          tone: "blocked" as Tone,
          detail: `The mandate refused $${money(res.lastPurchase?.amount)}: ${shown}. Nothing was spent.`,
          note: res.lastPurchase?.message,
        };
      }

      return {
        tone: "stalled" as Tone,
        detail:
          held.family === "request"
            ? `Prava rejected the request for $${money(res.lastPurchase?.amount)}: ${shown}. The call was malformed on our side, no mandate rule was involved.`
            : held.family === "provider"
              ? `The payment provider could not process $${money(res.lastPurchase?.amount)}: ${shown}. The mandate did not refuse it.`
              : `The charge for $${money(res.lastPurchase?.amount)} did not complete: ${shown}. Prava did not say whether a mandate rule stopped it.`,
        note: res.lastPurchase?.message,
      };
    };

    const doEvolve = async () => {
      await step("evolve", "Breed four variants of the winner", async () => {
        const cohort = cohortOf(held.current);
        const parent = held.evaluation?.candidateId
          ? (cohort.find((c) => c.id === held.evaluation?.candidateId) ?? leaderOf(cohort))
          : leaderOf(cohort);
        if (!parent) throw new Error("There was no winning creative left to breed from");
        held.parentCtr = ctr(parent.arm.impressions, parent.arm.clicks);

        const next = await call<State>(
          "/api/creatives",
          { parentId: parent.id, state: held.current },
          TIMEOUT.creatives,
          "The breeding step",
        );
        held.current = absorb(next);
        held.evolved = true;
        held.breeds += 1;
        held.decided = false;
        onDecision(null, null);
        const bred = cohortOf(held.current);
        note(`bred ${bred.length} mutations of the winner into generation ${bred[0]?.generation ?? 1}`);
        return {
          detail: `Bred ${bred.length} mutations of "${parent.headline}" into generation ${
            bred[0]?.generation ?? 1
          }`,
        };
      });
    };

    const doRetest = async (size: number) => {
      await step("simulate", `Retest with ${size.toLocaleString()} more`, async () => {
        const next = await call<State>(
          "/api/simulate",
          { impressions: size, state: held.current },
          TIMEOUT.simulate,
          "The second traffic simulation",
        );
        held.current = absorb(next);
        held.retested = true;
        const cohort = cohortOf(held.current);
        const fresh = bestCtrOf(cohort);
        const lift = held.parentCtr > 0 ? fresh / held.parentCtr - 1 : 0;
        note(`retested generation ${cohort[0]?.generation ?? 1} with ${size} impressions`);
        return {
          detail: `Served ${size.toLocaleString()} more impressions on generation ${
            cohort[0]?.generation ?? 1
          }, best click through rate ${pct(fresh, 2)} against the ${pct(
            held.parentCtr,
            2,
          )} of the parent`,
          note:
            lift > 0
              ? `The bred generation is running ${pct(lift, 0)} above the ad it came from`
              : undefined,
        };
      });
    };

    const endNoBuy = () => {
      const looked = held.round === 1 ? "The agent looked once" : `The agent looked ${held.round} times`;
      if (gatesCleared(held.evaluation)) {
        setEnding({
          kind: "held",
          headline: "The evidence cleared, the mandate did not",
          text: `This is a valid outcome, not a failure. All four gates opened on look ${held.round}: the evidence was enough and the agent judged the leading ad had earned the spend. What held the money is the mandate, not the statistics. A Prava mandate on a monthly frequency allows one charge per cycle, so once the signed mandates are charged there is nothing left to spend against until the seller signs another one. The reason the agent gave sits on the decide step above.${
            held.naiveLook !== null
              ? ` The fixed-horizon rule the industry uses would have called this winner at look ${held.naiveLook}. banditd did not trust it until look ${held.round}, when the evidence survived repeated looks.`
              : ""
          }`,
        });
        return;
      }
      setEnding({
        kind: "held",
        headline: "The agent decided not to spend",
        text: `${
          held.gate
            ? `This is a valid outcome, not a failure. ${looked} as traffic came in and the gate "${held.gate}" never opened, so it kept the money and the run ends here.`
            : `This is a valid outcome, not a failure. ${looked} as traffic came in and the statistics never cleared the gates, so it kept the money and the run ends here.`
        }${
          held.naiveLook !== null
            ? ` The fixed-horizon rule the industry uses would have bought at look ${held.naiveLook}, on evidence that never ended up holding. banditd kept the money.`
            : ""
        }`,
      });
    };

    const endDeclined = () => {
      const code = held.declined ?? "no code returned";
      const decided = `The gates opened on look ${held.round} and the agent decided to buy, which is the part banditd answers for and it worked.`;

      if (held.family === "provider") {
        setEnding({
          kind: "stalled",
          headline: "The payment provider could not process the charge",
          text: `${decided} What failed after that is the payment provider: Prava could not complete the charge and came back with ${code}. This is not the guardrail working. No rule on the mandate refused this spend, no money moved and no card was ever issued. The decision above stands and the same charge goes out when the provider can process it.`,
        });
        return;
      }

      if (held.family === "request") {
        setEnding({
          kind: "stalled",
          headline: "The purchase request was rejected before any mandate rule",
          text: `${decided} The charge never got as far as the mandate: Prava rejected the request itself with ${code}, which is a fault on our side of the call and not the guardrail refusing the spend. Nothing was spent and the run ends here.`,
        });
        return;
      }

      if (held.family === "unknown") {
        setEnding({
          kind: "stalled",
          headline: "The charge did not complete",
          text: `${decided} The charge came back as ${code} and Prava did not say whether a rule on the mandate stopped it or the payment side failed, so this run does not prove the guardrail did anything. Nothing was spent and the run ends here.`,
        });
        return;
      }

      setEnding({
        kind: "blocked",
        headline: CYCLE_BLOCKS.has(code)
          ? "The mandate had no charge left"
          : "The mandate refused the charge",
        text: CYCLE_BLOCKS.has(code)
          ? `The gates opened and the agent decided to buy, then the mandate refused the charge. Code returned: ${code}. A Prava mandate on a monthly frequency allows one charge per cycle and the signed mandates are already charged in this one. Nothing left the account and the run ends here.`
          : `The guardrail did its job and the agent could not spend. Code returned: ${code}. Nothing left the account and the run ends here.`,
      });
    };

    const endComplete = () => {
      setEnding({
        kind: "complete",
        headline: "The full loop closed",
        text: `Researched, wrote, served traffic across ${looksWord(
          held.round,
        )} until the anytime valid frontier cleared, spent under the mandate, bred the winner and retested the next generation.${
          held.naiveLook !== null
            ? ` The fixed-horizon rule the industry uses would have spent the $${money(
                held.decision?.amount,
              )} at look ${held.naiveLook}, before the evidence survived repeated looks. banditd waited until look ${held.round}.`
            : ""
        }`,
      });
    };

    const scripted = async (resume: boolean) => {
      if (resume) {
        setEntries((prev) => [
          ...prev,
          {
            id: `handoff_${(seqRef.current += 1)}`,
            task: "plan",
            label: "Fell back to the scripted order",
            status: "stalled",
            detail:
              "The agent stopped choosing its own next step, so the run hands the rest over to the fixed order it always had as a backup. Nothing below this line was chosen by the model.",
            startedAt: Date.now(),
          },
        ]);
      }

      if (!resume || !held.current.research) await doResearch();
      guard();

      if (!resume || cohortOf(held.current).length === 0) await doCreatives();
      guard();

      if (resume && held.bought) {
        if (!held.evolved) {
          await doEvolve();
          guard();
        }
        if (!held.retested) await doRetest(impressions);
        endComplete();
        return;
      }

      if (!(resume && held.purchaseAttempts > 0)) {
        for (let attempt = 1; ; attempt += 1) {
          await serve(
            attempt === 1
              ? "Serve traffic and look again until the gates open"
              : held.plan
                ? `Serve the ${held.plan.targetImpressions.toLocaleString()} impressions the agent asked for`
                : "Serve more traffic and look again",
          );

          guard();

          await settle(attempt === 1 ? "Evaluate and decide" : "Decide again on the fresh evidence");

          guard();

          const stalled =
            held.decision?.shouldBuy !== true &&
            (held.evaluation?.sufficientEvidence === false || held.plan !== null) &&
            held.round < MAX_ROUNDS &&
            attempt < MAX_DECISIONS;

          if (!stalled) break;
        }

        if (!held.decision?.shouldBuy) {
          endNoBuy();
          return;
        }

        await attemptPurchase("Execute the purchase", false);
        guard();
      }

      if (!held.bought) {
        endDeclined();
        return;
      }

      await doEvolve();
      guard();
      await doRetest(impressions);
      endComplete();
    };

    const refuse = (why: string, what: string) => {
      seqRef.current += 1;
      setEntries((prev) => [
        ...prev,
        {
          id: `refused_${seqRef.current}`,
          task: "plan",
          label: `The machine refused to ${what}`,
          status: "blocked",
          detail: why,
          startedAt: Date.now(),
          seconds: 0,
        },
      ]);
      note(`asked to ${what} and the machine refused it: ${why}`);
    };

    const askPlan = async (cycle: number) => {
      const box: { pick: PlanResponse | null } = { pick: null };
      await step("plan", `Cycle ${cycle} of ${MAX_PLAN_CYCLES}: choose the next action`, async () => {
        try {
          const res = await call<PlanResponse>(
            "/api/plan",
            {
              state: held.current,
              cycle,
              history: held.history,
              lastDecision: held.decision
                ? held.decision.shouldBuy
                  ? `cleared a spend of ${held.decision.amount}: ${held.decision.reason}`
                  : `held the money: ${held.decision.abstainedBecause ?? held.decision.reason}`
                : null,
              lastPurchase: held.lastPurchaseNote,
              progress: {
                researched: held.researched || Boolean(held.current.research),
                wrote: held.wrote,
                decided: held.decided,
                purchaseAttempts: held.purchaseAttempts,
                purchased: held.bought,
                evolved: held.evolved,
                retested: held.retested,
                looksTaken: held.round,
                looksLeft: Math.max(0, MAX_ROUNDS - held.round),
              },
            },
            TIMEOUT.plan,
            "The next action",
          );
          if (res.state) held.current = absorb(res.state);
          box.pick = res;

          setPlans((prev) => [
            ...prev,
            {
              cycle,
              action: res.choice.action,
              reason: plain(res.choice.reason),
              source: res.source,
              impressions: res.choice.impressions,
            },
          ]);

          if (res.source === "fallback") {
            return {
              tone: "stalled" as Tone,
              detail: `The agent did not return a usable choice, so this step fell back to the scripted order and takes the next scripted action: ${ACTION_LABEL[res.choice.action]}.`,
              note: res.fallbackBecause ?? undefined,
            };
          }

          return {
            detail: `Chose to ${ACTION_LABEL[res.choice.action]}${
              res.choice.impressions
                ? ` with ${res.choice.impressions.toLocaleString()} more impressions`
                : ""
            }`,
            note: plain(res.choice.reason),
          };
        } catch (err) {
          if (err instanceof Cancelled) throw err;
          box.pick = null;
          return {
            tone: "stalled" as Tone,
            detail:
              "The agent could not be reached to choose the next action, so the run hands the rest over to the scripted order.",
            note: err instanceof Error ? err.message : undefined,
          };
        }
      });
      return box.pick;
    };

    const plannerLoop = async (): Promise<"done" | "fallback"> => {
      let cycle = 0;
      let soft = 0;
      let refusals = 0;

      while (cycle < MAX_PLAN_CYCLES) {
        cycle += 1;
        guard();

        const pick = await askPlan(cycle);
        if (!pick) return "fallback";
        if (pick.source === "fallback") {
          soft += 1;
          if (soft > SOFT_FALLBACKS) return "fallback";
        }

        guard();
        const { action, impressions: asked, reason } = pick.choice;

        const blocked = (why: string, what: string): boolean => {
          refusals += 1;
          refuse(why, what);
          return refusals >= 2;
        };

        if (action === "stop") {
          if (cohortImpressions() === 0 && held.round < MAX_ROUNDS) {
            if (
              blocked(
                  "The run does not end before it has measured anything. No impressions have been served on this cohort, so there is no evidence to stop on.",
                "stop the run",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          if (held.bought && held.evolved && held.retested) {
            endComplete();
            return "done";
          }
          setEnding({
            kind: held.bought ? "complete" : "held",
            headline: "The agent ended the run itself",
            text: `${plain(reason)} Nothing after this was scripted: the agent chose every step above, and it chose to stop here rather than keep spending cycles.`,
          });
          return "done";
        }

        if (action === "research") {
          await doResearch();
          refusals = 0;
          continue;
        }

        if (action === "creatives") {
          if (!held.current.research) {
            if (
              blocked(
                "The creatives endpoint refuses to write anything before the market research exists. Nothing was written.",
                "write the creatives",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          if (held.writes >= MAX_WRITES) {
            if (
              blocked(
                `This run writes at most ${MAX_WRITES} fresh cohorts, and that is spent. The limit is on the run, not on the agent's judgement.`,
                "write the creatives",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          await doCreatives();
          refusals = 0;
          continue;
        }

        if (action === "serve_traffic") {
          if (cohortOf(held.current).length === 0) {
            if (
              blocked(
                "There is no cohort to serve traffic to, so the simulation was refused. Nothing was served.",
                "serve traffic",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          if (held.round >= MAX_ROUNDS) {
            if (
              blocked(
                `The run is capped at ${MAX_ROUNDS} looks at the same test and every one is spent. Nothing was served.`,
                "serve traffic",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          const size = asked ?? impressions;
          held.plan = {
            targetImpressions: cohortImpressions() + size,
            reason: plain(reason),
          };
          await serve(`Serve ${size.toLocaleString()} impressions the agent asked for`);
          refusals = 0;
          continue;
        }

        if (action === "evaluate") {
          if (cohortOf(held.current).length === 0) {
            if (
              blocked(
                "There is nothing measured to evaluate, so the decision endpoint was refused. No money was involved.",
                "evaluate the evidence",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          await settle("Evaluate the evidence and decide on the spend");
          refusals = 0;
          continue;
        }

        if (action === "purchase") {
          if (held.bought) {
            if (
              blocked(
                "This run buys one pack of render credits and it is already paid for. A second charge was refused before it was sent.",
                "buy render credits",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          if (held.purchaseAttempts >= MAX_PURCHASE_ATTEMPTS) {
            if (
              blocked(
                `The run is capped at ${MAX_PURCHASE_ATTEMPTS} charge attempts and both are spent. Nothing was sent.`,
                "buy render credits",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          refusals = 0;
          await attemptPurchase("Charge the mandate for render credits", true);
          if (!held.bought && held.declined !== null) {
            endDeclined();
            return "done";
          }
          continue;
        }

        if (action === "evolve") {
          if (cohortOf(held.current).length === 0 || leaderOf(cohortOf(held.current)) === null) {
            if (blocked("There is no winning creative to breed from, so nothing was bred.", "breed the winner")) return "fallback";
            continue;
          }
          if (held.breeds >= MAX_BREEDS) {
            if (
              blocked(
                `This run breeds at most ${MAX_BREEDS} generations and that is spent.`,
                "breed the winner",
              )
            ) {
              return "fallback";
            }
            continue;
          }
          held.retested = false;
          await doEvolve();
          refusals = 0;
          continue;
        }
      }

      return "fallback";
    };

    try {
      if (AUTONOMOUS) {
        const outcome = await plannerLoop();
        if (outcome === "fallback") await scripted(true);
      } else {
        await scripted(false);
      }
    } catch (err) {
      if (err instanceof Cancelled) {
        setEnding({
          kind: "stopped",
          headline: "Stopped mid run",
          text: "Nothing else was requested. Everything already done above is kept, and the manual controls below pick up from here.",
        });
      } else {
        setEnding({
          kind: "failed",
          headline: "The run stopped on a failed step",
          text:
            err instanceof Error
              ? err.message
              : "A step failed without saying why. The manual controls below still work step by step.",
        });
      }
    } finally {
      cancelledRef.current = false;
      controllerRef.current = null;
      onRunningChange(false);
    }
  }, [state, absorb, impressions, call, callRaw, step, onDecision, onReceipt, onRunningChange]);

  const ready = Boolean(state?.product);
  const patience = active !== null && waited >= PATIENCE_AFTER;

  useEffect(() => {
    if (!ready || disabled || running) return;
    if (!claimAutorun()) return;
    void start();
  }, [ready, disabled, running, start]);

  const endingTone = useMemo(() => {
    if (!ending) return "";
    if (ending.kind === "complete") return "border-white/25 bg-white/[0.06]";
    if (ending.kind === "held") return "border-white/12 bg-white/[0.03]";
    if (ending.kind === "stopped") return "border-white/15 bg-white/[0.04]";
    if (ending.kind === "stalled") return "border-amber-400/40 bg-amber-400/[0.08]";
    return "border-rose-400/40 bg-rose-500/[0.08]";
  }, [ending]);

  const endingLabel = useMemo(() => {
    if (!ending) return "";
    if (ending.kind === "complete") return "text-white";
    if (ending.kind === "held") return "text-zinc-300";
    if (ending.kind === "stopped") return "text-zinc-400";
    if (ending.kind === "stalled") return "text-amber-200";
    return "text-rose-300";
  }, [ending]);

  return (
    <section className="overflow-hidden rounded-2xl bg-white/[0.04]">
      <div className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-950">
            One click
          </span>
          <h2 className="t-title text-white">
            Run the whole demo
          </h2>
        </div>

        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-zinc-300">
          {AUTONOMOUS
            ? `The agent picks its own next step every cycle out of seven, up to ${MAX_PLAN_CYCLES} of them, and says why each time. Research, ads, traffic, evidence, spend, breed or stop. It spends only when all four gates open, and the server checks them again before any money moves.`
            : `Research, four ads with images, then traffic in rounds of ${impressions.toLocaleString()} with the evidence re-read after each one, up to ${MAX_ROUNDS} looks. It spends only when all four gates open.`}
        </p>

        {running ? (
          <button
            type="button"
            onClick={cancel}
            className="mt-3 w-full rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-[15px] font-bold text-rose-200 transition-colors hover:bg-rose-500/20"
          >
            Stop the run
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!ready || disabled}
            className="mt-3 w-full rounded-xl bg-white px-4 py-3.5 text-[15px] font-bold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 sm:text-base"
          >
            {entries.length > 0 ? "Run the full demo again" : "Run the full demo"}
          </button>
        )}

        <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
          {ready
            ? "Live run: real web search, real image generation and a real sandbox charge against the signed mandate."
            : "Submit a product on the home page first, then this runs the whole story on its own."}
        </p>

        {footer ? <div className="mt-3 border-t border-white/10 pt-3">{footer}</div> : null}
      </div>

      {active ? (
        <div className="border-t border-white/10 px-3 pb-3 sm:px-4">
          <div className="pt-3">
            <AgentStatus title={AGENT_STEPS[active.task].title} steps={AGENT_STEPS[active.task].steps} />
          </div>
          {patience ? (
            <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
              {active.task === "simulate"
                ? `Still working after ${waited}s. The loop keeps serving traffic and re-reading the frontier every round, this is the test running, not a hang.`
                : `Still working after ${waited}s. The web search and the image renders regularly take more than a minute, this is waiting, not broken.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {plans.length > 0 ? <PlanTrack plans={plans} /> : null}

      {rounds.length > 0 ? <RoundTrack rounds={rounds} /> : null}

      {entries.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 pt-3 sm:px-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              What the agent did
            </span>
            <span className="text-[12px] tabular-nums text-zinc-400">
              {entries.filter((e) => e.status !== "running").length} of{" "}
              {Math.max(TOTAL_STEPS, entries.length)}
            </span>
          </div>
          <ol className="divide-y divide-white/5 pb-1">
            {entries.map((entry) => (
              <TimelineRow key={entry.id} entry={entry} />
            ))}
          </ol>
        </>
      ) : null}

      {ending ? (
        <div className="px-3 pb-3 sm:px-4">
          <div role="alert" className={`rounded-xl border px-3 py-2.5 ${endingTone}`}>
            <div
              className={`text-[11px] font-bold uppercase tracking-[0.14em] ${endingLabel}`}
            >
              {ending.headline}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-zinc-200">
              {ending.text}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
