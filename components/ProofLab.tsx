"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DEFAULT_ALPHA,
  EVIDENCE_CALIBRATION,
  createRng,
  evaluate,
  logCohortBayesFactor,
  simulateTraffic,
  type Arm,
  type EvaluateOptions,
  type Rng,
} from "@/lib/bandit";
import { pct } from "./format";
import { reducedMotion } from "./motion";

export type ProofTruth = "identical" | "winner";

export interface ProofScore {
  runs: number;
  naiveFalse: number;
  naiveRight: number;
  gatedFalse: number;
  gatedRight: number;
  naiveFired: number;
  gatedFired: number;
  naiveLost: number;
  gatedLost: number;
  heldLost: number;
}

export type ProofTone = "auto" | "panel";

interface Props {
  className?: string;
  defaultTruth?: ProofTruth;
  defaultArms?: 2 | 4;
  defaultLift?: number;
  looks?: number;
  horizon?: number;
  batchSize?: number;
  autoBatch?: boolean;
  seed?: number;
  tone?: ProofTone;
  folded?: boolean;
  headingLevel?: 3 | 4;
  onScore?: (score: ProofScore) => void;
}

const PANEL_TOKENS = {
  "--background": "#09090b",
  "--surface": "#0e0e11",
  "--surface-2": "#141417",
  "--foreground": "#fafafa",
  "--muted": "#d4d4d8",
  "--subtle": "#a1a1aa",
  "--border": "rgba(255, 255, 255, 0.1)",
  "--border-strong": "rgba(255, 255, 255, 0.22)",
  "--accent": "#34d399",
  "--accent-foreground": "#04140c",
  "--accent-soft": "rgba(52, 211, 153, 0.12)",
  "--danger": "#fb7185",
  "--danger-soft": "rgba(251, 113, 133, 0.12)",
  "--ring": "rgba(250, 250, 250, 0.6)",
  "--card-shadow": "none",
} as CSSProperties;

const BASE_RATE = 0.03;
const THRESHOLD = 0.95;
const MIN_IMPRESSIONS = 200;
const NAIVE_SAMPLES = 500;
const GATED_SAMPLES = 20000;
const PREVIEW_SAMPLES = 3000;
const LOG_EVIDENCE = Math.log(1 / DEFAULT_ALPHA);
const LOOK_MS = 38;
const BUDGET_MS = 8;
const LIFTS = [25, 50, 100];
const NAMES = ["Ad A", "Ad B", "Ad C", "Ad D"];
const GATE_NAMES = ["Traffic", "Ahead", "Gap", "Looks"];

const NAIVE_OPTIONS: EvaluateOptions = {
  samples: NAIVE_SAMPLES,
  threshold: THRESHOLD,
  minImpressions: MIN_IMPRESSIONS,
  candidateRule: "sample",
  priorAlpha: 1,
  priorBeta: 1,
};

const GATED_OPTIONS: EvaluateOptions = {
  samples: GATED_SAMPLES,
  threshold: THRESHOLD,
  minImpressions: MIN_IMPRESSIONS,
};

export interface ProofSetup {
  arms: number;
  truth: ProofTruth;
  lift: number;
  looks: number;
  horizon: number;
}

type Setup = ProofSetup;

interface Verdict {
  fired: boolean;
  correct: boolean;
  candidate: number;
  firedAt: number;
  probabilityBest: number;
  gates: boolean[];
  regret: number;
}

interface Run {
  arms: Arm[];
  look: number;
  traffic: Rng;
  naiveRng: Rng;
  gatedRng: Rng;
  naive: Verdict;
  gated: Verdict;
}

interface Snapshot {
  look: number;
  served: number;
  arms: Arm[];
  naive: Verdict;
  gated: Verdict;
  finished: boolean;
}

interface Board {
  runs: number;
  naiveFalse: number;
  naiveRight: number;
  gatedFalse: number;
  gatedRight: number;
  naiveFired: number;
  gatedFired: number;
  naiveLost: number;
  gatedLost: number;
  heldLost: number;
  naiveTrail: number[];
  gatedTrail: number[];
}

function emptyBoard(): Board {
  return {
    runs: 0,
    naiveFalse: 0,
    naiveRight: 0,
    gatedFalse: 0,
    gatedRight: 0,
    naiveFired: 0,
    gatedFired: 0,
    naiveLost: 0,
    gatedLost: 0,
    heldLost: 0,
    naiveTrail: [],
    gatedTrail: [],
  };
}

function blankVerdict(): Verdict {
  return {
    fired: false,
    correct: false,
    candidate: -1,
    firedAt: 0,
    probabilityBest: 0,
    gates: [false, false, false, false],
    regret: 0,
  };
}

function ratesOf(setup: Setup): number[] {
  const rates = new Array<number>(setup.arms).fill(BASE_RATE);
  if (setup.truth === "winner") rates[setup.arms - 1] = BASE_RATE * (1 + setup.lift / 100);
  return rates;
}

function bestOf(setup: Setup): number {
  return setup.truth === "winner" ? setup.arms - 1 : -1;
}

function spanOf(setup: Setup): number {
  return Math.max(1, Math.floor(setup.horizon / setup.looks)) * setup.looks;
}

function regretOf(arms: Arm[], rates: number[], best: number): number {
  if (best < 0) return 0;
  let acc = 0;
  for (let i = 0; i < arms.length; i++) acc += arms[i].impressions * (rates[best] - rates[i]);
  return acc;
}

function heldCost(setup: Setup, rates: number[], best: number): number {
  if (best < 0) return 0;
  const share = spanOf(setup) / setup.arms;
  let acc = 0;
  for (const r of rates) acc += share * (rates[best] - r);
  return acc;
}

function costOf(
  verdict: Verdict,
  setup: Setup,
  rates: number[],
  best: number,
  held: number,
): number {
  if (best < 0) return 0;
  if (!verdict.fired) return held;
  const picked = rates[verdict.candidate] ?? rates[best];
  return verdict.regret + Math.max(0, spanOf(setup) - verdict.firedAt) * (rates[best] - picked);
}

function startRun(setup: Setup, seed: number): Run {
  return {
    arms: Array.from({ length: setup.arms }, (_, i) => ({
      id: NAMES[i],
      impressions: 0,
      clicks: 0,
    })),
    look: 0,
    traffic: createRng(seed),
    naiveRng: createRng(seed ^ 0x9e3779b9),
    gatedRng: createRng(seed ^ 0x85ebca6b),
    naive: blankVerdict(),
    gated: blankVerdict(),
  };
}

function reachable(arms: Arm[]): boolean {
  let top = 0;
  for (const arm of arms) if (arm.impressions > top) top = arm.impressions;
  if (top < MIN_IMPRESSIONS) return false;
  return logCohortBayesFactor(arms) - Math.log(EVIDENCE_CALIBRATION) >= LOG_EVIDENCE;
}

function stepRun(run: Run, setup: Setup, rates: number[], best: number, detailed: boolean): void {
  const step = Math.max(1, Math.floor(setup.horizon / setup.looks));
  run.arms = simulateTraffic(run.arms, rates, step, run.traffic, "even");
  run.look += 1;

  if (!run.naive.fired) {
    const res = evaluate(run.arms, { ...NAIVE_OPTIONS, rng: run.naiveRng });
    run.naive.probabilityBest = res.probabilityBest;
    run.naive.candidate = res.candidateIndex;
    if (res.thresholdMet && res.minImpressionsMet) {
      run.naive.fired = true;
      run.naive.correct = res.candidateIndex === best;
      run.naive.firedAt = res.totalImpressions;
      run.naive.regret = regretOf(run.arms, rates, best);
    }
  }

  if (run.gated.fired) return;

  const decisive = reachable(run.arms);
  if (decisive || detailed) {
    const res = evaluate(run.arms, {
      ...GATED_OPTIONS,
      samples: decisive ? GATED_SAMPLES : PREVIEW_SAMPLES,
      rng: run.gatedRng,
    });
    run.gated.probabilityBest = res.probabilityBest;
    run.gated.candidate = res.candidateIndex;
    run.gated.gates = [
      res.minImpressionsMet,
      res.thresholdMet,
      res.effectSizeOk,
      res.anytimeValid,
    ];
    if (decisive && res.sufficientEvidence) {
      run.gated.fired = true;
      run.gated.correct = res.candidateIndex === best;
      run.gated.firedAt = res.totalImpressions;
      run.gated.regret = regretOf(run.arms, rates, best);
    }
  }
}

function snapshot(run: Run, setup: Setup): Snapshot {
  let served = 0;
  for (const arm of run.arms) served += arm.impressions;
  return {
    look: run.look,
    served,
    arms: run.arms.map((a) => ({ ...a })),
    naive: { ...run.naive, gates: [...run.naive.gates] },
    gated: { ...run.gated, gates: [...run.gated.gates] },
    finished: run.look >= setup.looks,
  };
}

function record(board: Board, run: Run, setup: Setup, rates: number[], best: number): void {
  board.runs += 1;
  if (run.naive.fired) {
    board.naiveFired += 1;
    if (run.naive.correct) board.naiveRight += 1;
    else board.naiveFalse += 1;
  }
  if (run.gated.fired) {
    board.gatedFired += 1;
    if (run.gated.correct) board.gatedRight += 1;
    else board.gatedFalse += 1;
  }
  const held = heldCost(setup, rates, best);
  board.heldLost += held;
  board.naiveLost += costOf(run.naive, setup, rates, best, held);
  board.gatedLost += costOf(run.gated, setup, rates, best, held);
  board.naiveTrail.push(board.naiveFalse / board.runs);
  board.gatedTrail.push(board.gatedFalse / board.runs);
}

function scoreOf(board: Board): ProofScore {
  return {
    runs: board.runs,
    naiveFalse: board.naiveFalse,
    naiveRight: board.naiveRight,
    gatedFalse: board.gatedFalse,
    gatedRight: board.gatedRight,
    naiveFired: board.naiveFired,
    gatedFired: board.gatedFired,
    naiveLost: board.naiveLost,
    gatedLost: board.gatedLost,
    heldLost: board.heldLost,
  };
}

function later(task: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(() => task(), { timeout: 64 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.requestAnimationFrame(() => task());
  return () => window.cancelAnimationFrame(handle);
}

function group(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function rate(hits: number, runs: number): number {
  return runs > 0 ? hits / runs : 0;
}

function trailPath(values: number[], top: number): string {
  if (values.length < 2) return "";
  const stride = Math.max(1, Math.ceil(values.length / 120));
  const points: string[] = [];
  for (let i = 0; i < values.length; i += stride) {
    const x = (240 * i) / (values.length - 1);
    const y = 44 - (40 * Math.min(1, values[i] / top));
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const lastX = 240;
  const lastY = 44 - 40 * Math.min(1, values[values.length - 1] / top);
  points.push(`${lastX},${lastY.toFixed(1)}`);
  return `M${points.join("L")}`;
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

function Segmented({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { value: string; text: string }[];
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <div role="group" aria-label={label} className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(option.value)}
              className={`focus-ring hover-tint min-h-11 min-w-0 rounded-lg border px-2.5 py-1.5 text-[0.8125rem] font-medium sm:min-h-0 ${
                on
                  ? "border-foreground/25 bg-foreground text-background"
                  : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {option.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Meter({ value, tone }: { value: number; tone: string }) {
  return (
    <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
      <div
        className={`h-full rounded-full ${tone}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
      <span
        aria-hidden
        className="absolute inset-y-0 w-px bg-foreground/40"
        style={{ left: `${THRESHOLD * 100}%` }}
      />
    </div>
  );
}

function AdRow({
  arm,
  name,
  best,
  picked,
}: {
  arm: Arm;
  name: string;
  best: boolean;
  picked: boolean;
}) {
  const ctr = arm.impressions > 0 ? arm.clicks / arm.impressions : 0;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-2 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="min-w-0 truncate text-[0.75rem] font-medium">{name}</span>
        <span className="shrink-0 font-mono text-[0.75rem] tabular-nums text-muted">
          {pct(ctr, 2)}
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className={`h-full rounded-full ${picked ? "bg-foreground" : "bg-foreground/35"}`}
          style={{ width: `${Math.max(0, Math.min(1, ctr / (BASE_RATE * 2.4))) * 100}%` }}
        />
      </div>
      <p className="mt-1 truncate text-[0.6875rem] text-subtle">
        {group(arm.impressions)} shown{best ? ", truly best" : ""}
      </p>
    </div>
  );
}

function RuleCard({
  title,
  rule,
  verdict,
  snap,
  truth,
  gated,
  looks,
  headingLevel = 4,
}: {
  title: string;
  rule: string;
  verdict: Verdict;
  snap: Snapshot | null;
  truth: ProofTruth;
  gated: boolean;
  looks: number;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const started = Boolean(snap && snap.look > 0);
  const done = Boolean(snap?.finished);
  const state = verdict.fired
    ? verdict.correct
      ? "right"
      : "false"
    : done
      ? "held"
      : started
        ? "watching"
        : "idle";

  const badge =
    state === "false"
      ? { text: truth === "identical" ? "False winner" : "Wrong ad", css: "border-danger/40 bg-danger-soft text-danger" }
      : state === "right"
        ? { text: "Correct call", css: "border-accent bg-accent text-accent-foreground" }
        : state === "held"
          ? {
              text: truth === "identical" ? "No winner called" : "No call",
              css:
                truth === "identical"
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface-2 text-muted",
            }
          : state === "watching"
            ? { text: "Watching", css: "border-border bg-surface-2 text-muted" }
            : { text: "Ready", css: "border-border bg-surface-2 text-subtle" };

  const line =
    state === "false"
      ? truth === "identical"
        ? `Stopped at ${group(verdict.firedAt)} impressions and crowned ${
            NAMES[verdict.candidate] ?? "an ad"
          }. Every ad here has the same true click rate, so that winner does not exist.`
        : `Stopped at ${group(verdict.firedAt)} impressions and crowned ${
            NAMES[verdict.candidate] ?? "an ad"
          }, which is not the better ad.`
      : state === "right"
        ? `Stopped at ${group(verdict.firedAt)} impressions and crowned ${
            NAMES[verdict.candidate] ?? "an ad"
          }, the ad that really is better.`
        : state === "held"
          ? truth === "identical"
            ? `Held through all ${looks} looks and never called a winner. Correct, there is none.`
            : `Held through all ${looks} looks. It never got the evidence it needs, so it spent nothing.`
          : state === "watching"
            ? `Look ${snap?.look ?? 0} of ${looks}. Still watching.`
            : "Waiting for traffic.";

  const tone =
    state === "false"
      ? "border-danger/35"
      : state === "right" || (state === "held" && truth === "identical")
        ? "border-accent/35"
        : "border-border";

  return (
    <div className={`min-w-0 rounded-xl border bg-surface-2 p-3 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <Heading className="t-caption min-w-0 break-words font-semibold leading-tight text-foreground">
            {title}
          </Heading>
          <p className="mt-0.5 break-words text-[0.75rem] leading-snug text-subtle">{rule}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] ${badge.css}`}
        >
          {badge.text}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 text-[0.6875rem] text-subtle">Sure it found the best</span>
          <span className="shrink-0 font-mono text-[0.8125rem] font-medium tabular-nums">
            {started ? pct(verdict.probabilityBest) : "0.0%"}
          </span>
        </div>
        <Meter
          value={started ? verdict.probabilityBest : 0}
          tone={state === "false" ? "bg-danger" : state === "right" ? "bg-accent" : "bg-foreground/60"}
        />
        <p className="mt-1 text-[0.625rem] text-subtle">Line marks the 95% bar</p>
      </div>

      {gated ? (
        <ul className="mt-2.5 grid grid-cols-2 gap-1">
          {GATE_NAMES.map((name, i) => (
            <li
              key={name}
              className={`flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[0.6875rem] ${
                verdict.gates[i]
                  ? "border-accent/45 bg-accent-soft text-foreground"
                  : "border-border bg-surface text-subtle"
              }`}
            >
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${
                  verdict.gates[i] ? "bg-accent" : "bg-foreground/25"
                }`}
              />
              <span className="min-w-0 truncate">{name}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2.5 break-words text-[0.75rem] leading-relaxed text-muted">{line}</p>
    </div>
  );
}

function ScoreRow({
  label,
  value,
  runs,
  hits,
  tone,
  bar,
}: {
  label: string;
  value: number;
  runs: number;
  hits: number;
  tone: string;
  bar: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="min-w-0 break-words text-[0.8125rem] text-muted">{label}</span>
        <span className={`shrink-0 font-mono text-[1.125rem] font-semibold tabular-nums ${tone}`}>
          {runs > 0 ? pct(value) : "0.0%"}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className={`bar-fill h-full w-full rounded-full ${bar}`}
          style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }}
        />
      </div>
      <p className="mt-1 text-[0.6875rem] tabular-nums text-subtle">
        {group(hits)} of {group(runs)} {runs === 1 ? "run" : "runs"}
      </p>
    </div>
  );
}

function CostCard({
  title,
  fires,
  lost,
  worst,
  runs,
  tone,
  bar,
}: {
  title: string;
  fires: number;
  lost: number;
  worst: number;
  runs: number;
  tone: string;
  bar: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-2.5 py-2">
      <p className="min-w-0 break-words text-[0.8125rem] font-semibold leading-tight">{title}</p>
      <p className="mt-1 break-words text-[0.6875rem] leading-snug text-subtle">
        Called a winner in{" "}
        <span className="font-mono tabular-nums text-muted">{runs > 0 ? pct(fires) : "0.0%"}</span>{" "}
        of runs
      </p>
      <p className="mt-2 text-[0.6875rem] leading-snug text-subtle">Clicks lost per run</p>
      <p className={`font-mono text-[1.125rem] font-semibold leading-tight tabular-nums ${tone}`}>
        {lost.toFixed(1)}
      </p>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className={`bar-fill h-full w-full rounded-full ${bar}`}
          style={{ transform: `scaleX(${worst > 0 ? Math.min(1, lost / worst) : 0})` }}
        />
      </div>
    </div>
  );
}

export default function ProofLab({
  className = "",
  defaultTruth = "identical",
  defaultArms = 2,
  defaultLift = 50,
  looks = 48,
  horizon = 12000,
  batchSize = 100,
  autoBatch = true,
  seed = 4000,
  tone = "auto",
  folded = false,
  headingLevel = 4,
  onScore,
}: Props) {
  const [truth, setTruth] = useState<ProofTruth>(defaultTruth);
  const [arms, setArms] = useState<number>(defaultArms === 4 ? 4 : 2);
  const [lift, setLift] = useState<number>(defaultLift);
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [live, setLive] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<"idle" | "live" | "batch">("idle");
  const [pending, setPending] = useState(0);

  const boardRef = useRef<Board>(emptyBoard());
  const cancelRef = useRef<(() => void) | null>(null);
  const jobRef = useRef(0);
  const seedRef = useRef(seed);
  const reportRef = useRef<((score: ProofScore) => void) | undefined>(onScore);

  const setup = useMemo<Setup>(
    () => ({ arms, truth, lift, looks, horizon }),
    [arms, truth, lift, looks, horizon],
  );

  const stop = useCallback(() => {
    jobRef.current += 1;
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  useEffect(() => {
    reportRef.current = onScore;
  }, [onScore]);

  useEffect(
    () => () => {
      jobRef.current += 1;
      cancelRef.current?.();
    },
    [],
  );

  useEffect(() => {
    reportRef.current?.(scoreOf(board));
  }, [board]);

  const runBatch = useCallback(
    (count: number) => {
      stop();
      if (count <= 0) return;
      const job = jobRef.current;
      const rates = ratesOf(setup);
      const best = bestOf(setup);
      let left = count;
      let run: Run | null = null;
      setBusy("batch");
      setPending(left);

      const pump = () => {
        if (jobRef.current !== job) return;
        const started = performance.now();
        while (left > 0 && performance.now() - started < BUDGET_MS) {
          if (!run) {
            run = startRun(setup, seedRef.current);
            seedRef.current += 7919;
          }
          stepRun(run, setup, rates, best, false);
          if (run.look >= setup.looks || (run.naive.fired && run.gated.fired)) {
            record(boardRef.current, run, setup, rates, best);
            run = null;
            left -= 1;
          }
        }
        setBoard({ ...boardRef.current });
        setPending(left);
        if (left > 0) {
          cancelRef.current = later(pump);
          return;
        }
        cancelRef.current = null;
        setBusy("idle");
      };

      cancelRef.current = later(pump);
    },
    [setup, stop],
  );

  const runLive = useCallback(() => {
    stop();
    const job = jobRef.current;
    const rates = ratesOf(setup);
    const best = bestOf(setup);
    const run = startRun(setup, seedRef.current);
    seedRef.current += 7919;
    const paced = !reducedMotion();
    let last = 0;
    let frame = 0;

    setBusy("live");
    setPending(0);
    setLive(snapshot(run, setup));

    const tick = (now: number) => {
      if (jobRef.current !== job) return;
      if (!paced || now - last >= LOOK_MS) {
        last = now;
        stepRun(run, setup, rates, best, true);
        setLive(snapshot(run, setup));
      }
      if (run.look < setup.looks) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      cancelRef.current = null;
      record(boardRef.current, run, setup, rates, best);
      setBoard({ ...boardRef.current });
      if (autoBatch && batchSize > 1) {
        runBatch(batchSize - 1);
        return;
      }
      setBusy("idle");
    };

    frame = window.requestAnimationFrame(tick);
    cancelRef.current = () => window.cancelAnimationFrame(frame);
  }, [autoBatch, batchSize, runBatch, setup, stop]);

  const reset = useCallback(() => {
    stop();
    boardRef.current = emptyBoard();
    seedRef.current = seed;
    setBoard(emptyBoard());
    setLive(null);
    setPending(0);
    setBusy("idle");
  }, [seed, stop]);

  const halt = useCallback(() => {
    stop();
    setPending(0);
    setBusy("idle");
  }, [stop]);

  const best = bestOf(setup);
  const naiveFalseRate = rate(board.naiveFalse, board.runs);
  const gatedFalseRate = rate(board.gatedFalse, board.runs);
  const naiveRightRate = rate(board.naiveRight, board.runs);
  const gatedRightRate = rate(board.gatedRight, board.runs);
  const top = Math.max(0.1, naiveFalseRate * 1.25, gatedFalseRate * 1.25);
  const naiveFireRate = rate(board.naiveFired, board.runs);
  const gatedFireRate = rate(board.gatedFired, board.runs);
  const naiveLost = rate(board.naiveLost, board.runs);
  const gatedLost = rate(board.gatedLost, board.runs);
  const heldLost = rate(board.heldLost, board.runs);
  const worstLost = Math.max(heldLost, naiveLost, gatedLost);
  const cheaper =
    board.runs === 0 || Math.abs(naiveLost - gatedLost) <= 0.5
      ? "level"
      : naiveLost < gatedLost
        ? "naive"
        : "gated";
  const served = live?.served ?? 0;
  const progress = setup.horizon > 0 ? Math.min(1, served / setup.horizon) : 0;
  const running = busy !== "idle";

  const headline =
    board.runs === 0
      ? "Pick a scenario and run it. Both rules read the same traffic, one look at a time."
      : truth === "identical"
        ? `Over ${group(board.runs)} run${board.runs === 1 ? "" : "s"} on ads with the same true click rate, the naive rule invented a winner ${pct(
            naiveFalseRate,
          )} of the time. The four gates: ${pct(gatedFalseRate)}.`
        : `Over ${group(board.runs)} run${board.runs === 1 ? "" : "s"}, the naive rule found the better ad ${pct(
            naiveRightRate,
          )} of the time and picked the wrong one ${pct(
            naiveFalseRate,
          )} of the time. The four gates: ${pct(gatedRightRate)} right, ${pct(gatedFalseRate)} wrong.`;

  const tokens = tone === "panel" ? PANEL_TOKENS : undefined;

  const panel = (
    <section
      aria-label="Proof lab"
      className={`card overflow-hidden p-3 sm:p-6 ${folded ? "mt-3 rounded-2xl" : className}`.trim()}
      style={folded ? undefined : tokens}
    >
      {folded ? null : (
        <>
          <p className="eyebrow">Proof lab, running in your browser</p>
          <h3 className="t-small mt-2 text-balance font-semibold text-foreground">
            Same ads, same traffic, two ways to call a winner.
          </h3>
        </>
      )}
      <p
        className={`max-w-2xl text-pretty text-[0.875rem] leading-relaxed text-muted ${
          folded ? "" : "mt-2"
        }`.trim()}
      >
        The naive rule stops the moment one ad looks 95% likely to be best. Banditd needs all four
        gates to clear. Choose a truth the ads do not know about, then watch which rule respects it
        and what respecting it costs in clicks.
      </p>

      <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
        <Segmented
          label="Hidden truth"
          value={truth}
          onPick={(value) => {
            reset();
            setTruth(value as ProofTruth);
          }}
          options={[
            { value: "identical", text: "All ads identical" },
            { value: "winner", text: "One ad is better" },
          ]}
        />
        <Segmented
          label="Ads in the test"
          value={String(arms)}
          onPick={(value) => {
            reset();
            setArms(Number(value));
          }}
          options={[
            { value: "2", text: "2 ads" },
            { value: "4", text: "4 ads" },
          ]}
        />
        {truth === "winner" ? (
          <Segmented
            label="How much better"
            value={String(lift)}
            onPick={(value) => {
              reset();
              setLift(Number(value));
            }}
            options={LIFTS.map((value) => ({ value: String(value), text: `+${value}%` }))}
          />
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="eyebrow">Traffic in this run</span>
          <span className="font-mono text-[0.8125rem] tabular-nums text-muted">
            {group(served)} of {group(setup.horizon)} impressions, look{" "}
            {Math.min(live?.look ?? 0, setup.looks)} of {setup.looks}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-foreground/60"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(live?.arms ?? Array.from({ length: setup.arms }, () => ({ impressions: 0, clicks: 0 }))).map(
            (arm, i) => (
              <AdRow
                key={NAMES[i]}
                arm={arm}
                name={NAMES[i]}
                best={i === best}
                picked={live?.naive.fired === true && live.naive.candidate === i}
              />
            ),
          )}
        </div>
        <p className="mt-2 text-pretty text-[0.6875rem] leading-relaxed text-subtle">
          {truth === "identical"
            ? `Every ad has the same ${pct(BASE_RATE, 1)} true click rate, so there is no winner to find.`
            : `${NAMES[best] ?? "One ad"} truly clicks at ${pct(
                BASE_RATE * (1 + lift / 100),
                1,
              )} and the rest at ${pct(BASE_RATE, 1)}.`}{" "}
          Traffic is split evenly and both rules read the exact same numbers.
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <RuleCard
          headingLevel={headingLevel}
          title="Naive rule"
          rule="Stops as soon as P(best) passes 95%"
          verdict={live?.naive ?? blankVerdict()}
          snap={live}
          truth={truth}
          gated={false}
          looks={setup.looks}
        />
        <RuleCard
          headingLevel={headingLevel}
          title="Banditd, four gates"
          rule="P(best), enough traffic, a gap worth money, and an anytime valid bound"
          verdict={live?.gated ?? blankVerdict()}
          snap={live}
          truth={truth}
          gated
          looks={setup.looks}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runLive}
          disabled={running}
          className="focus-ring hover-tint min-h-11 rounded-lg border border-foreground/25 bg-foreground px-3.5 py-2 text-[0.8125rem] font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-0"
        >
          {busy === "live" ? "Running live" : "Run one live"}
        </button>
        <button
          type="button"
          onClick={() => runBatch(batchSize)}
          disabled={running}
          className="focus-ring hover-tint min-h-11 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-[0.8125rem] font-medium text-muted hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-0"
        >
          Repeat {group(batchSize)} times
        </button>
        {running ? (
          <button
            type="button"
            onClick={halt}
            className="focus-ring hover-tint min-h-11 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-[0.8125rem] font-medium text-muted hover:border-border-strong hover:text-foreground sm:min-h-0"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={reset}
            disabled={board.runs === 0}
            className="focus-ring hover-tint min-h-11 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-[0.8125rem] font-medium text-muted hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-0"
          >
            Reset
          </button>
        )}
        {busy === "batch" ? (
          <span className="font-mono text-[0.75rem] tabular-nums text-subtle">
            {group(pending)} {pending === 1 ? "run" : "runs"} left
          </span>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="eyebrow">Scoreboard</span>
          <span className="font-mono text-[0.8125rem] tabular-nums text-muted">
            {group(board.runs)} run{board.runs === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ScoreRow
            label={
              truth === "identical"
                ? "Naive rule called a winner that is not there"
                : "Naive rule crowned the wrong ad"
            }
            value={naiveFalseRate}
            runs={board.runs}
            hits={board.naiveFalse}
            tone="text-danger"
            bar="bg-danger"
          />
          <ScoreRow
            label={
              truth === "identical"
                ? "Four gates called a winner that is not there"
                : "Four gates crowned the wrong ad"
            }
            value={gatedFalseRate}
            runs={board.runs}
            hits={board.gatedFalse}
            tone="text-accent"
            bar="bg-accent"
          />
          {truth === "winner" ? (
            <>
              <ScoreRow
                label="Naive rule found the better ad"
                value={naiveRightRate}
                runs={board.runs}
                hits={board.naiveRight}
                tone="text-foreground"
                bar="bg-foreground/60"
              />
              <ScoreRow
                label="Four gates found the better ad"
                value={gatedRightRate}
                runs={board.runs}
                hits={board.gatedRight}
                tone="text-foreground"
                bar="bg-foreground/60"
              />
            </>
          ) : null}
        </div>

        {board.runs > 2 ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="eyebrow">False winner rate as the runs pile up</p>
            <svg
              viewBox="0 0 240 48"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Naive rule at ${pct(naiveFalseRate)}, four gates at ${pct(gatedFalseRate)}`}
              className="mt-2 h-12 w-full"
            >
              <path
                d={trailPath(board.naiveTrail, top)}
                fill="none"
                stroke="var(--danger)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={trailPath(board.gatedTrail, top)}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-subtle">
              <span className="flex items-center gap-1">
                <span aria-hidden className="size-1.5 rounded-full bg-danger" />
                Naive rule
              </span>
              <span className="flex items-center gap-1">
                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                Four gates
              </span>
              <span className="tabular-nums">top of chart {pct(top)}</span>
            </div>
          </div>
        ) : null}

        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-pretty border-t border-border pt-3 text-[0.8125rem] leading-relaxed text-muted"
        >
          {headline}
        </p>
      </div>

      <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="eyebrow">What the caution costs</span>
          {board.runs > 0 ? (
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] ${
                truth === "identical"
                  ? "border-border bg-surface text-muted"
                  : cheaper === "naive"
                    ? "border-danger/40 bg-danger-soft text-danger"
                    : cheaper === "gated"
                      ? "border-accent/45 bg-accent-soft text-foreground"
                      : "border-border bg-surface text-muted"
              }`}
            >
              {truth === "identical"
                ? "Same price here"
                : cheaper === "naive"
                  ? "Naive rule cheaper here"
                  : cheaper === "gated"
                    ? "Four gates cheaper here"
                    : "Level on cost here"}
            </span>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <CostCard
            title="Naive rule"
            fires={naiveFireRate}
            lost={naiveLost}
            worst={worstLost}
            runs={board.runs}
            tone="text-foreground"
            bar="bg-foreground/60"
          />
          <CostCard
            title="Banditd, four gates"
            fires={gatedFireRate}
            lost={gatedLost}
            worst={worstLost}
            runs={board.runs}
            tone="text-foreground"
            bar="bg-foreground/60"
          />
        </div>

        <p className="mt-2.5 text-pretty text-[0.75rem] leading-relaxed text-muted">
          {board.runs === 0
            ? "Run a scenario to price it. Lost clicks are counted against an oracle that knew the winner from the first impression, so lower is better."
            : truth === "identical"
              ? `Both rules lose zero clicks here, because every ad pays the same ${pct(
                  BASE_RATE,
                  1,
                )} and there is no better ad to steer traffic to. The whole difference is the false winner rate above. Switch the hidden truth to one ad being better to see what the gate costs.`
              : cheaper === "naive"
                ? `The naive rule is cheaper here. It loses ${naiveLost.toFixed(
                    1,
                  )} clicks a run against our ${gatedLost.toFixed(
                    1,
                  )}, because we keep paying for the even split while we wait. That is the case against us and it is a fair one.`
                : cheaper === "gated"
                  ? `The four gates are cheaper here, ${gatedLost.toFixed(
                      1,
                    )} clicks a run against the naive rule's ${naiveLost.toFixed(
                      1,
                    )}. Its false winners cost more than our waiting does.`
                  : `Neither rule is cheaper here. The two land within half a click a run of each other.`}
        </p>

        {truth === "winner" && board.runs > 0 ? (
          <p className="mt-2 text-pretty text-[0.6875rem] leading-relaxed text-subtle">
            Never deciding at all costs {heldLost.toFixed(1)} clicks a run. Lost clicks are counted
            against an oracle that knew the winner from the first impression, so lower is better.
            When a rule fires, the rest of the run goes to the ad it picked, right or wrong.
          </p>
        ) : null}

        <p className="mt-2 text-pretty border-t border-border pt-2.5 text-[0.75rem] leading-relaxed text-muted">
          The gate protects against declaring a false winner, and that is the error that matters
          when the spend is automatic and irreversible and the seller then scales the creative. The
          naive rule decides sooner, and that matters when being wrong is cheap. Both are true at
          once.
        </p>
      </div>

      {truth === "identical" && arms === 4 ? (
        <p className="mt-3 text-pretty text-[0.75rem] leading-relaxed text-subtle">
          Four ads look safer than two for the naive rule, and that is the trap. Passing 95% is
          harder when there are more ads to beat, so the error rate drops without the error going
          away. Switch back to two ads to see it in full.
        </p>
      ) : null}

      <p className="mt-3 text-pretty text-[0.75rem] leading-relaxed text-subtle">
        Each run serves {group(setup.horizon)} impressions and is checked {setup.looks} times, which
        is what an agent that rechecks after every batch actually does. Nothing here calls a server,
        a model or a payment API. Same engine as{" "}
        <code className="break-words rounded border border-border bg-surface px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">
          node scripts/bandit-test.mts
        </code>
        .
      </p>
    </section>
  );

  if (!folded) return panel;

  return (
    <details className={`group ${className}`.trim()} style={tokens}>
      <summary className="hover-tint focus-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 px-3 py-3 hover:border-border-strong sm:px-4">
        <span className="min-w-0">
          <span className="block break-words text-[0.8125rem] font-semibold text-foreground">
            Check the false winner rate, and what it costs, yourself
          </span>
          <span className="mt-0.5 block break-words text-[0.6875rem] leading-snug text-muted">
            Same ads, same traffic, two ways to call a winner, scored on both false winners and
            clicks lost. It runs in this browser, calls no API and spends nothing.
          </span>
        </span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-transform duration-200 group-open:rotate-180">
          <Caret />
        </span>
      </summary>
      {panel}
    </details>
  );
}
