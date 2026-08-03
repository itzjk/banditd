"use client";
import {
  DEFAULT_ALPHA,
  DEFAULT_EFFECT_SIZE_TOLERANCE,
  DEFAULT_MIN_IMPRESSIONS,
  DEFAULT_THRESHOLD,
} from "@/lib/bandit";

import { useEffect, useState, type ReactNode } from "react";
import { pct } from "./format";
import { reducedMotion } from "./motion";

export interface GateEvaluation {
  candidateIndex?: number;
  probabilityBest?: number;
  sufficientEvidence?: boolean;
  totalImpressions?: number;
  expectedLoss?: number;
  eValue?: number;
  posteriorMean?: number;
  thresholdMet?: boolean;
  minImpressionsMet?: boolean;
  effectSizeOk?: boolean;
  anytimeValid?: boolean;
}

interface Props {
  evaluation?: GateEvaluation | null;
  threshold?: number;
  minImpressions?: number;
  candidateImpressions?: number;
  effectSizeTolerance?: number;
  alpha?: number;
  candidateLabel?: string | null;
  mandateBlocked?: boolean;
}

interface Gate {
  id: string;
  name: string;
  met: boolean;
  current: string;
  unit: string;
  required: string;
  meaning: string;
  action: string;
  progress: number;
}

const SETTLED = 5;

const GATE_COPY = [
  {
    id: "traffic",
    name: "Enough traffic",
    meaning:
      "Without enough data, any winner is just noise. The count is the simulated traffic on the candidate itself, not on the whole cohort.",
  },
  {
    id: "ahead",
    name: "One ad clearly ahead",
    meaning: "How sure we are that this ad is truly the best one.",
  },
  {
    id: "gap",
    name: "The gap is worth money",
    meaning: "If the difference is tiny, switching is not worth spending on.",
  },
  {
    id: "looks",
    name: "Holds up to repeated looks",
    meaning: "Checking the data over and over inflates false winners. This gate blocks that.",
  },
] as const;

function count(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

function strength(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  if (value >= 1000) return `${Math.round(value).toLocaleString()}`;
  return value.toFixed(1);
}

function loss(value: number): string {
  if (!Number.isFinite(value)) return "not measured";
  return pct(value, 3);
}

function ratio(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

function SimTag() {
  return (
    <span className="rounded-full border border-white/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
      Simulated traffic
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WaitIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.6V8l2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function GateRow({
  gate,
  blocking,
  resolved,
}: {
  gate: Gate;
  blocking: boolean;
  resolved: boolean;
}) {
  const edge = !resolved
    ? "border-white/10"
    : gate.met
      ? "border-emerald-400/60"
      : blocking
        ? "border-amber-400/60"
        : "border-white/12";

  const tint = !resolved
    ? ""
    : gate.met
      ? "bg-emerald-400/[0.045]"
      : blocking
        ? "bg-amber-400/[0.045]"
        : "";

  const badge = !resolved
    ? "border-white/10 bg-white/5 text-zinc-300"
    : gate.met
      ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
      : blocking
        ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
        : "border-white/10 bg-white/5 text-zinc-300";

  const bar = gate.met ? "bg-emerald-400" : blocking ? "bg-amber-400" : "bg-zinc-700";
  const veil = resolved ? "opacity-100" : "opacity-40";

  return (
    <li className="bg-zinc-950">
      <div
        className={`h-full border-l-2 px-3 py-3 transition-colors duration-200 sm:px-4 ${edge} ${tint}`}
      >
        <div className="flex items-start justify-between gap-2">
          <h4 className="t-caption min-w-0 break-words font-semibold leading-snug text-zinc-100">
            {gate.name}
          </h4>
          <span
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-opacity duration-200 ${badge} ${veil}`}
          >
            {gate.met ? <CheckIcon /> : <WaitIcon />}
            {gate.met ? "Cleared" : "Pending"}
          </span>
        </div>

        <div
          className={`mt-2.5 flex items-baseline justify-between gap-2 transition-opacity duration-200 ${veil}`}
        >
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={`text-[17px] font-semibold leading-none tabular-nums ${
                resolved && gate.met ? "text-white" : "text-zinc-100"
              }`}
            >
              {gate.current}
            </span>
            <span className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
              {gate.unit}
            </span>
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-zinc-400">{gate.required}</span>
        </div>

        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`bar-fill h-full w-full ${bar}`}
            style={{
              transform: `scaleX(${
                resolved ? Math.max(gate.progress > 0 ? 0.03 : 0, gate.progress) : 0
              })`,
            }}
          />
        </div>

        <p className="mt-2.5 break-words text-[13px] leading-relaxed text-zinc-400">
          {gate.meaning}
        </p>

        {!gate.met && blocking ? (
          <p
            className={`mt-1.5 break-words text-[12px] font-medium leading-relaxed text-zinc-300 transition-opacity duration-200 ${veil}`}
          >
            {gate.action}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Decision gates"
      className="overflow-hidden rounded-2xl"
    >
      {children}
    </section>
  );
}

export default function GatesPanel({
  evaluation,
  threshold = DEFAULT_THRESHOLD,
  minImpressions = DEFAULT_MIN_IMPRESSIONS,
  candidateImpressions,
  effectSizeTolerance = DEFAULT_EFFECT_SIZE_TOLERANCE,
  alpha = DEFAULT_ALPHA,
  candidateLabel,
  mandateBlocked = false,
}: Props) {
  const signature = evaluation
    ? [
        evaluation.totalImpressions ?? 0,
        evaluation.probabilityBest ?? 0,
        evaluation.expectedLoss ?? 0,
        evaluation.eValue ?? 0,
      ].join("|")
    : "";
  const [reveal, setReveal] = useState({ sig: signature, step: SETTLED });

  if (reveal.sig !== signature) {
    setReveal({ sig: signature, step: signature && !reducedMotion() ? 1 : SETTLED });
  }
  const revealed = reveal.step;

  useEffect(() => {
    if (!signature || reducedMotion()) return;
    const timers = [2, 3, 4, 5].map((step) =>
      window.setTimeout(() => {
        setReveal((prev) => (prev.sig === signature ? { sig: signature, step } : prev));
      }, (step - 1) * 80),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [signature]);

  if (!evaluation) {
    return (
      <Shell>
        <div className="border-b border-white/10 px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <h3 className="t-small font-semibold text-white">Decision gates</h3>
              <p className="mt-0.5 break-words text-[12px] leading-snug text-zinc-400">
                Four conditions. All four clear before a cent moves.
              </p>
            </div>
            <SimTag />
          </div>
          <p className="mt-2.5 break-words text-[13px] leading-relaxed text-zinc-400">
            No evaluation yet. The four gates fill in here once traffic starts.
          </p>
        </div>
        <ul className="grid gap-px bg-white/[0.07] sm:grid-cols-2">
          {GATE_COPY.map((gate) => (
            <li key={gate.id} className="bg-zinc-950">
              <div className="h-full border-l-2 border-white/10 px-3 py-3 sm:px-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="t-caption min-w-0 break-words font-semibold leading-snug text-zinc-400">
                    {gate.name}
                  </h4>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                    Not run
                  </span>
                </div>
                <p className="mt-2.5 break-words text-[13px] leading-relaxed text-zinc-400">
                  {gate.meaning}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Shell>
    );
  }

  const onCandidate = typeof candidateImpressions === "number";
  const impressions = onCandidate ? candidateImpressions : (evaluation.totalImpressions ?? 0);
  const probabilityBest = evaluation.probabilityBest ?? 0;
  const expectedLoss = evaluation.expectedLoss ?? Number.POSITIVE_INFINITY;
  const posteriorMean = evaluation.posteriorMean ?? 0;
  const eValue = evaluation.eValue ?? 0;
  const evidenceTarget = alpha > 0 ? 1 / alpha : 20;
  const lossBudget = effectSizeTolerance * (posteriorMean > 0 ? posteriorMean : 1);

  const trafficMet = evaluation.minImpressionsMet ?? impressions >= minImpressions;
  const aheadMet = evaluation.thresholdMet ?? probabilityBest > threshold;
  const gapMet = evaluation.effectSizeOk ?? expectedLoss < lossBudget;
  const looksMet = evaluation.anytimeValid ?? eValue >= evidenceTarget;

  const missing = Math.max(0, Math.ceil(minImpressions - impressions));

  const gates: Gate[] = [
    {
      ...GATE_COPY[0],
      met: trafficMet,
      current: count(impressions),
      unit: onCandidate ? "on the candidate" : "across the cohort",
      required: `${count(minImpressions)} needed`,
      action: `The candidate needs ${count(missing)} more simulated ${missing === 1 ? "impression" : "impressions"}. Keep the test running.`,
      progress: ratio(impressions, minImpressions),
    },
    {
      ...GATE_COPY[1],
      met: aheadMet,
      current: pct(probabilityBest),
      unit: "sure it is best",
      required: `${pct(threshold)} needed`,
      action: `The leader sits at ${pct(probabilityBest)} and has to pass ${pct(
        threshold,
      )}. More traffic separates it from the rest.`,
      progress: ratio(probabilityBest, threshold),
    },
    {
      ...GATE_COPY[2],
      met: gapMet,
      current: loss(expectedLoss),
      unit: "expected loss",
      required: `under ${loss(lossBudget)}`,
      action: `The gap between the leader and the pack is still worth ${loss(
        expectedLoss,
      )}, above the ${loss(lossBudget)} the agent will tolerate.`,
      progress: !Number.isFinite(expectedLoss) ? 0 : expectedLoss > 0 ? ratio(lossBudget, expectedLoss) : 1,
    },
    {
      ...GATE_COPY[3],
      met: looksMet,
      current: strength(eValue),
      unit: "evidence strength",
      required: `${strength(evidenceTarget)} needed`,
      action: `Evidence strength is ${strength(eValue)} and has to reach ${strength(
        evidenceTarget,
      )}. Only new traffic moves this, looking again does not.`,
      progress: ratio(eValue, evidenceTarget),
    },
  ];

  const cleared = gates.filter((g) => g.met).length;
  const allMet = cleared === gates.length;
  const ready = evaluation.sufficientEvidence ?? allMet;
  const blocker = ready ? null : (gates.find((g) => !g.met) ?? null);
  const clearedSoFar = gates.slice(0, revealed).filter((g) => g.met).length;
  const verdictOut = revealed > gates.length;

  return (
    <Shell>
      <div className="border-b border-white/10 px-3 py-3 sm:px-4 sm:py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h3 className="t-small font-semibold text-white">Decision gates</h3>
            <p className="mt-0.5 break-words text-[12px] leading-snug text-zinc-400">
              Four conditions. All four clear before a cent moves.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SimTag />
            <span className="text-[12px] font-semibold tabular-nums text-zinc-300">
              {clearedSoFar} of {gates.length}
            </span>
          </div>
        </div>

        <div className="mt-3 flex gap-1" aria-hidden="true">
          {gates.map((gate, i) => (
            <span
              key={gate.id}
              className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                i >= revealed
                  ? "bg-white/10"
                  : gate.met
                    ? "bg-emerald-400"
                    : gate.id === blocker?.id
                      ? "bg-amber-400"
                      : "bg-white/10"
              }`}
            />
          ))}
        </div>

        <div
          role="status"
          aria-live="polite"
          className={`mt-3 transition-opacity duration-200 ${verdictOut ? "opacity-100" : "opacity-0"}`}
        >
          {ready ? (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.07] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                <CheckIcon />
                All four gates cleared
              </div>
              <p className="mt-1 break-words text-[14px] leading-relaxed text-zinc-200">
                {candidateLabel ? `"${candidateLabel}"` : "The leading ad"} has earned the budget. The
                agent is cleared to spend on it.
              </p>
              {mandateBlocked ? (
                <p className="mt-1.5 break-words text-[12px] leading-relaxed text-zinc-400">
                  The statistics cleared and the money still did not move: the mandate has no charge
                  left in this cycle. That block is on the leash, not on the evidence.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-200">
                <WaitIcon />
                Waiting on: {blocker ? blocker.name : "one more check"}
              </div>
              <p className="mt-1 break-words text-[14px] leading-relaxed text-zinc-200">
                {blocker ? blocker.action : "The agent is holding until every gate clears."}
              </p>
              {aheadMet && !looksMet ? (
                <p className="mt-1.5 break-words text-[12px] leading-relaxed text-zinc-300">
                  A fixed-horizon test would call this now. The e-value says the evidence does not
                  survive repeated looks yet.
                </p>
              ) : null}
              <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
                Nothing is broken. The agent is deliberately not spending until this clears.
              </p>
            </div>
          )}
        </div>
      </div>

      <ul className="grid gap-px bg-white/[0.07] sm:grid-cols-2">
        {gates.map((gate, i) => (
          <GateRow
            key={gate.id}
            gate={gate}
            blocking={gate.id === blocker?.id}
            resolved={i < revealed}
          />
        ))}
      </ul>
    </Shell>
  );
}
