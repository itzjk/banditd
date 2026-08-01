"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Creative, State } from "@/lib/store";
import { evaluate } from "@/lib/bandit";
import AgentStatus from "@/components/AgentStatus";
import { ctr, money, pct } from "@/components/format";

export type Task =
  | "load"
  | "research"
  | "creatives"
  | "evolve"
  | "simulate"
  | "decide"
  | "purchase"
  | "force";

export interface Decision {
  shouldBuy: boolean;
  amount: string | null;
  reason: string;
  abstainedBecause: string | null;
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
  message?: string;
  forced?: boolean;
  cardLast4?: string | null;
}

interface DecideResponse {
  decision: Decision;
  evaluation: Evaluation;
  state: State;
}

type PurchaseResponse = State & { lastPurchase?: LastPurchase };

export const AGENT_STEPS: Record<Task, { title: string; steps: string[] }> = {
  load: { title: "Waking up", steps: ["Reading the agent state"] },
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
      "Rendering 4 images",
      "Loading every variant into the bandit",
    ],
  },
  evolve: {
    title: "Breeding the winner",
    steps: [
      "Taking the winning creative apart",
      "Writing 4 mutations of that angle",
      "Rendering the new images",
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
};

const TIMEOUT: Record<string, number> = {
  research: 240000,
  creatives: 300000,
  simulate: 60000,
  decide: 240000,
  purchase: 120000,
};

const TOTAL_STEPS = 7;
const PATIENCE_AFTER = 20;

const MAX_ROUNDS = 12;
const MAX_DECISIONS = 2;
const ROUND_GROWTH = 1.8;
const ROUND_CEILING = 400000;
const ROUND_SAMPLES = 20000;
const EVIDENCE_TARGET = 20;
const ROUND_PAUSE = 180;

type Tone = "done" | "held" | "blocked";
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

type EndingKind = "complete" | "held" | "blocked" | "failed" | "stopped";

interface Ending {
  kind: EndingKind;
  headline: string;
  text: string;
}

class Cancelled extends Error {}

interface Props {
  state: State | null;
  absorb: (next: State) => State;
  impressions: number;
  disabled: boolean;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onDecision: (decision: Decision | null, evaluation: Evaluation | null) => void;
  onReceipt: (receipt: LastPurchase | null) => void;
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

function strength(value: number): string {
  if (!Number.isFinite(value)) return "off the scale";
  if (value >= 1000) {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
      value,
    );
  }
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(2);
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
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Anytime valid frontier
        </span>
        <span className="text-[11px] tabular-nums text-zinc-400">
          Look {latest.n} of {MAX_ROUNDS}
        </span>
      </div>

      <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
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
              <span className="text-[11px] text-zinc-400">of {EVIDENCE_TARGET} needed</span>
            </div>
          </div>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
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

        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          Every round is another look at the same test. Only new traffic moves this number, which is
          what makes looking again and again safe.
        </p>
      </div>

      <div className="mt-2 overflow-hidden rounded-xl border border-white/10">
        <div className="grid grid-cols-[1.6rem_1fr_3rem_3.4rem] gap-1 border-b border-white/10 bg-white/[0.03] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
          <span>Rd</span>
          <span>Impressions</span>
          <span className="text-right">Best</span>
          <span className="text-right">E value</span>
        </div>
        <ul className="divide-y divide-white/5">
          {rounds.map((row) => (
            <li
              key={row.n}
              className="enter-soft grid grid-cols-[1.6rem_1fr_3rem_3.4rem] items-baseline gap-1 px-2 py-1.5 text-[11px] tabular-nums"
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
        className={`mt-2 text-[11px] leading-relaxed ${
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

function StatusDot({ status }: { status: Status }) {
  if (status === "running") {
    return (
      <span className="relative mt-0.5 flex h-3 w-3 shrink-0">
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
        : status === "blocked" || status === "failed"
          ? "border-rose-400/50 bg-rose-500/20 text-rose-300"
          : "border-white/15 bg-white/10 text-zinc-500";

  return (
    <span
      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${tone}`}
    >
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
          : entry.status === "blocked" || entry.status === "failed"
            ? "text-rose-100"
            : "text-zinc-400";

  return (
    <li className="flex gap-2.5 px-3 py-2 sm:px-4">
      <StatusDot status={entry.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-[13px] font-semibold ${title}`}>{entry.label}</span>
          {typeof entry.seconds === "number" ? (
            <span className="text-[10px] tabular-nums text-zinc-400">{entry.seconds}s</span>
          ) : null}
        </div>
        {entry.detail ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{entry.detail}</p>
        ) : null}
        {entry.note ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">{entry.note}</p>
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
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [waited, setWaited] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);
  const pauseRef = useRef<{ timer: number; release: () => void } | null>(null);
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
    async <T,>(url: string, body: unknown, ms: number, label: string): Promise<T> => {
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
          const message =
            data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : `The server answered ${res.status} and gave no reason`;
          throw new Error(message);
        }
        return data as T;
      } catch (e) {
        if (cancelledRef.current) throw new Cancelled();
        if (expired) {
          throw new Error(
            `${label} ran past ${Math.round(ms / 1000)} seconds without answering. The server may still be finishing it, wait a moment and fire that step by hand from the manual controls.`,
          );
        }
        throw e instanceof Error ? e : new Error("The request never reached the server");
      } finally {
        clearTimeout(timer);
        controllerRef.current = null;
      }
    },
    [],
  );

  const breathe = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          pauseRef.current = null;
          resolve();
        }, ms);
        pauseRef.current = { timer, release: resolve };
      }),
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
    const waiting = pauseRef.current;
    if (waiting) {
      window.clearTimeout(waiting.timer);
      pauseRef.current = null;
      waiting.release();
    }
  }, []);

  const start = useCallback(async () => {
    if (!state?.product) return;

    cancelledRef.current = false;
    setEntries([]);
    setRounds([]);
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
      round: number;
      opened: boolean;
      parentCtr: number;
    } = {
      current: state,
      decision: null,
      evaluation: null,
      gate: null,
      bought: false,
      declined: null,
      round: 0,
      opened: false,
      parentCtr: 0,
    };

    const serve = async (label: string) => {
      await step("simulate", label, async (report) => {
        let last: Round | null = null;
        held.opened = false;

        while (held.round < MAX_ROUNDS) {
          held.round += 1;
          const size = roundSize(impressions, held.round);
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

          if (evaluation.sufficientEvidence) {
            held.opened = true;
            break;
          }

          guard();
          await breathe(ROUND_PAUSE);
          guard();
        }

        if (!last) throw new Error("The run was already out of looks before this traffic step");

        if (held.opened) {
          return {
            detail: `Gates opened on look ${last.n} with ${last.impressions.toLocaleString()} impressions served, evidence ${strength(
              last.eValue,
            )} against the ${EVIDENCE_TARGET} needed`,
            note: `Probability best reached ${pct(last.probabilityBest)} and the frontier held across ${
              last.n
            } looks at the same test`,
          };
        }

        return {
          tone: "held" as Tone,
          detail: `Served ${last.impressions.toLocaleString()} impressions across ${
            last.n
          } looks and the evidence stalled at ${strength(last.eValue)} of ${EVIDENCE_TARGET}`,
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
        onDecision(res.decision, res.evaluation);

        if (res.decision.shouldBuy) {
          return {
            detail: `Cleared to spend $${money(res.decision.amount)} at ${pct(
              res.evaluation.probabilityBest,
            )} probability best over ${res.evaluation.totalImpressions.toLocaleString()} impressions`,
            note: res.decision.reason,
          };
        }

        held.gate = blockingGate(res.evaluation);
        return {
          tone: "held" as Tone,
          detail: held.gate
            ? `Held the money. The gate that stopped it: ${held.gate}.`
            : "Held the money. The evidence never cleared the gates.",
          note: res.decision.abstainedBecause ?? res.decision.reason,
        };
      });
    };

    try {
      await step("research", "Research the market", async () => {
        const next = await call<State>(
          "/api/research",
          { state: held.current },
          TIMEOUT.research,
          "The market research",
        );
        held.current = absorb(next);
        const sources = held.current.research?.sources.length ?? 0;
        return {
          detail: sources
            ? `Read ${sources} live sources and wrote the buyer profile`
            : "Wrote the buyer profile off the live search",
        };
      });

      guard();

      await step("creatives", "Write four creatives", async () => {
        const next = await call<State>(
          "/api/creatives",
          { state: held.current },
          TIMEOUT.creatives,
          "The creative generation",
        );
        held.current = absorb(next);
        const cohort = cohortOf(held.current);
        return {
          detail: `Wrote ${cohort.length} ads with rendered images: ${cohort
            .map((c) => c.angle)
            .join(", ")}`,
        };
      });

      guard();

      for (let attempt = 1; ; attempt += 1) {
        await serve(
          attempt === 1
            ? "Serve traffic and look again until the gates open"
            : "Serve more traffic and look again",
        );

        guard();

        await settle(attempt === 1 ? "Evaluate and decide" : "Decide again on the fresh evidence");

        guard();

        const stalled =
          held.decision?.shouldBuy !== true &&
          held.evaluation?.sufficientEvidence === false &&
          held.round < MAX_ROUNDS &&
          attempt < MAX_DECISIONS;

        if (!stalled) break;
      }

      if (!held.decision?.shouldBuy) {
        setEnding({
          kind: "held",
          headline: "The agent decided not to spend",
          text: held.gate
            ? `This is a valid outcome, not a failure. The agent looked ${held.round} times as traffic came in and the gate "${held.gate}" never opened, so it kept the money and the run ends here.`
            : `This is a valid outcome, not a failure. The agent looked ${held.round} times as traffic came in and the statistics never cleared the gates, so it kept the money and the run ends here.`,
        });
        return;
      }

      await step("purchase", "Execute the purchase", async () => {
        const cohort = cohortOf(held.current);
        const res = await call<PurchaseResponse>(
          "/api/purchase",
          {
            amount: held.decision?.amount ?? "4.00",
            reason: held.decision?.reason ?? "Bandit called the winner",
            winnerId: held.evaluation?.candidateId ?? cohort[0]?.id,
            probabilityBest: held.evaluation?.probabilityBest ?? 0,
            impressions: cohort.reduce((sum, c) => sum + c.arm.impressions, 0),
            state: held.current,
          },
          TIMEOUT.purchase,
          "The purchase",
        );
        held.current = absorb(res);
        onReceipt(res.lastPurchase ?? null);
        held.bought = res.lastPurchase?.ok === true;

        if (held.bought) {
          return {
            detail: `Charged $${money(res.lastPurchase?.amount)} on a single use card ending ${
              res.lastPurchase?.cardLast4 ?? "????"
            }`,
          };
        }

        held.declined = res.lastPurchase?.errorCode ?? "declined";
        return {
          tone: "blocked",
          detail: `The mandate refused $${money(res.lastPurchase?.amount)}: ${held.declined}. Nothing was spent.`,
          note: res.lastPurchase?.message,
        };
      });

      guard();

      if (!held.bought) {
        setEnding({
          kind: "blocked",
          headline: "The mandate refused the charge",
          text: `The guardrail did its job and the agent could not spend. Code returned: ${
            held.declined ?? "declined"
          }. Nothing left the account and the run ends here.`,
        });
        return;
      }

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
        onDecision(null, null);
        const bred = cohortOf(held.current);
        return {
          detail: `Bred ${bred.length} mutations of "${parent.headline}" into generation ${
            bred[0]?.generation ?? 1
          }`,
        };
      });

      guard();

      await step("simulate", `Retest with ${impressions.toLocaleString()} more`, async () => {
        const next = await call<State>(
          "/api/simulate",
          { impressions, state: held.current },
          TIMEOUT.simulate,
          "The second traffic simulation",
        );
        held.current = absorb(next);
        const cohort = cohortOf(held.current);
        const fresh = bestCtrOf(cohort);
        const lift = held.parentCtr > 0 ? fresh / held.parentCtr - 1 : 0;
        return {
          detail: `Served ${impressions.toLocaleString()} more impressions on generation ${
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

      setEnding({
        kind: "complete",
        headline: "The full loop closed",
        text: `Researched, wrote, served traffic across ${held.round} looks until the anytime valid frontier cleared, spent under the mandate, bred the winner and retested the next generation.`,
      });
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
  }, [state, absorb, impressions, call, step, breathe, onDecision, onReceipt, onRunningChange]);

  const ready = Boolean(state?.product);
  const patience = active !== null && waited >= PATIENCE_AFTER;

  const endingTone = useMemo(() => {
    if (!ending) return "";
    if (ending.kind === "complete") return "border-white/25 bg-white/[0.06]";
    if (ending.kind === "held") return "border-white/12 bg-white/[0.03]";
    if (ending.kind === "stopped") return "border-white/15 bg-white/[0.04]";
    return "border-rose-400/40 bg-rose-500/[0.08]";
  }, [ending]);

  const endingLabel = useMemo(() => {
    if (!ending) return "";
    if (ending.kind === "complete") return "text-white";
    if (ending.kind === "held") return "text-zinc-300";
    if (ending.kind === "stopped") return "text-zinc-400";
    return "text-rose-300";
  }, [ending]);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04]">
      <div className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-950">
            One click
          </span>
          <h2 className="text-[15px] font-semibold tracking-tight text-white sm:text-base">
            Run the whole demo
          </h2>
        </div>

        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-zinc-300 sm:text-[13px]">
          End to end: research the market, write four ads with images, then serve traffic in rounds
          starting at {impressions.toLocaleString()} impressions and re-read the evidence after
          every round, up to {MAX_ROUNDS} looks. It spends only when all four gates open, then
          breeds the winner and retests. The manual controls below stay live for anyone who wants to
          walk it step by step.
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

        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
          {ready
            ? "Live run: real web search, real image generation and a real sandbox charge against the signed mandate."
            : "Submit a product on the home page first, then this runs the whole story on its own."}
        </p>
      </div>

      {active ? (
        <div className="border-t border-white/10 px-3 pb-3 sm:px-4">
          <div className="pt-3">
            <AgentStatus title={AGENT_STEPS[active.task].title} steps={AGENT_STEPS[active.task].steps} />
          </div>
          {patience ? (
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
              {active.task === "simulate"
                ? `Still working after ${waited}s. The loop keeps serving traffic and re-reading the frontier every round, this is the test running, not a hang.`
                : `Still working after ${waited}s. The web search and the image renders regularly take more than a minute, this is waiting, not broken.`}
            </p>
          ) : null}
        </div>
      ) : null}

      {rounds.length > 0 ? <RoundTrack rounds={rounds} /> : null}

      {entries.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 pt-3 sm:px-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              What the agent did
            </span>
            <span className="text-[11px] tabular-nums text-zinc-400">
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
          <div className={`rounded-xl border px-3 py-2.5 ${endingTone}`}>
            <div
              className={`text-[11px] font-bold uppercase tracking-[0.14em] ${endingLabel}`}
            >
              {ending.headline}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-200 sm:text-[13px]">
              {ending.text}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
