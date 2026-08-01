"use client";

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
}

interface Gate {
  id: string;
  name: string;
  met: boolean;
  current: string;
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
    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
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
  const tone = !resolved
    ? "border-white/10 bg-white/[0.02]"
    : gate.met
      ? "border-emerald-400/25 bg-emerald-400/[0.05]"
      : blocking
        ? "border-amber-400/40 bg-amber-400/[0.07]"
        : "border-white/10 bg-white/[0.02]";

  const badge = !resolved
    ? "border-white/10 bg-white/5 text-zinc-300"
    : gate.met
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : blocking
        ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
        : "border-white/10 bg-white/5 text-zinc-300";

  const bar = gate.met ? "bg-emerald-400" : blocking ? "bg-amber-400" : "bg-zinc-600";
  const veil = resolved ? "opacity-100" : "opacity-40";

  return (
    <li className={`rounded-xl border p-3 transition-colors duration-200 ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 text-[13px] font-semibold leading-snug text-zinc-100">{gate.name}</h4>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-opacity duration-200 ${badge} ${veil}`}
        >
          {gate.met ? <CheckIcon /> : <WaitIcon />}
          {gate.met ? "Cleared" : "Pending"}
        </span>
      </div>

      <div
        className={`mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px] tabular-nums transition-opacity duration-200 ${veil}`}
      >
        <span
          className={
            resolved && gate.met ? "font-semibold text-emerald-300" : "font-semibold text-zinc-100"
          }
        >
          {gate.current}
        </span>
        <span className="text-zinc-400">of</span>
        <span className="text-zinc-300">{gate.required}</span>
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

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{gate.meaning}</p>

      {!gate.met && blocking ? (
        <p
          className={`mt-1.5 text-[11px] font-medium leading-relaxed text-amber-200/90 transition-opacity duration-200 ${veil}`}
        >
          {gate.action}
        </p>
      ) : null}
    </li>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Decision gates"
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
    >
      {children}
    </section>
  );
}

export default function GatesPanel({
  evaluation,
  threshold = 0.95,
  minImpressions = 200,
  candidateImpressions,
  effectSizeTolerance = 0.01,
  alpha = 0.05,
  candidateLabel,
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
        <div className="border-b border-white/10 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Decision gates
            </div>
            <SimTag />
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
            No evaluation yet. The agent checks four conditions before it is allowed to spend, and
            they will fill in here once traffic starts.
          </p>
        </div>
        <ul className="grid gap-2 p-3 sm:p-4">
          {GATE_COPY.map((gate) => (
            <li key={gate.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[13px] font-semibold text-zinc-400">{gate.name}</h4>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-300">
                  Not run
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{gate.meaning}</p>
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
      current: `${count(impressions)} ${onCandidate ? "on the candidate" : "across the cohort"}`,
      required: `${count(minImpressions)} simulated impressions needed`,
      action: `The candidate needs ${count(missing)} more simulated impressions. Keep the test running.`,
      progress: ratio(impressions, minImpressions),
    },
    {
      ...GATE_COPY[1],
      met: aheadMet,
      current: pct(probabilityBest),
      required: `${pct(threshold)} confidence`,
      action: `The leader sits at ${pct(probabilityBest)} and has to pass ${pct(
        threshold,
      )}. More traffic separates it from the rest.`,
      progress: ratio(probabilityBest, threshold),
    },
    {
      ...GATE_COPY[2],
      met: gapMet,
      current: `${loss(expectedLoss)} expected loss`,
      required: `under ${loss(lossBudget)}`,
      action: `The gap between the leader and the pack is still worth ${loss(
        expectedLoss,
      )}, above the ${loss(lossBudget)} the agent will tolerate.`,
      progress: !Number.isFinite(expectedLoss) ? 0 : expectedLoss > 0 ? ratio(lossBudget, expectedLoss) : 1,
    },
    {
      ...GATE_COPY[3],
      met: looksMet,
      current: `${strength(eValue)} evidence`,
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
      <div className="border-b border-white/10 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Decision gates
            </div>
            <SimTag />
          </div>
          <div className="text-[11px] font-semibold tabular-nums text-zinc-400">
            {clearedSoFar} of {gates.length} cleared
          </div>
        </div>

        <div className="mt-2 flex gap-1" aria-hidden="true">
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
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-400/[0.08] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                <CheckIcon />
                All four gates cleared
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-200">
                {candidateLabel ? `"${candidateLabel}"` : "The leading ad"} has earned the budget. The
                agent is cleared to spend on it.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.08] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
                <WaitIcon />
                Waiting on: {blocker ? blocker.name : "one more check"}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-200">
                {blocker ? blocker.action : "The agent is holding until every gate clears."}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
                Nothing is broken. The agent is deliberately not spending until this clears.
              </p>
            </div>
          )}
        </div>
      </div>

      <ul className="grid gap-2 p-3 sm:p-4">
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
