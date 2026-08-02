import { evaluate, createRng, DEFAULT_THRESHOLD, DEFAULT_MIN_IMPRESSIONS, DEFAULT_ALPHA } from "./bandit.ts";
import { cohortSeed } from "./cohort-seed.ts";
import type { State, Creative } from "./state-schema.ts";

export const PLAN_ACTIONS = [
  "research",
  "creatives",
  "serve_traffic",
  "evaluate",
  "purchase",
  "evolve",
  "stop",
] as const;

export type PlanAction = (typeof PLAN_ACTIONS)[number];

export const MAX_PLAN_CYCLES = 14;
export const MIN_PLAN_IMPRESSIONS = 500;
export const MAX_PLAN_IMPRESSIONS = 60000;
export const DEFAULT_PLAN_IMPRESSIONS = 2000;
export const EVIDENCE_TARGET = Math.round(1 / DEFAULT_ALPHA);

export const ACTION_LABEL: Record<PlanAction, string> = {
  research: "research the market",
  creatives: "write the four creatives",
  serve_traffic: "serve traffic",
  evaluate: "evaluate the evidence",
  purchase: "buy render credits",
  evolve: "breed variants of the winner",
  stop: "stop the run",
};

export interface PlanProgress {
  researched: boolean;
  wrote: boolean;
  decided: boolean;
  purchaseAttempts: number;
  purchased: boolean;
  evolved: boolean;
  retested: boolean;
  looksTaken: number;
  looksLeft: number;
}

export interface PlanArm {
  headline: string;
  angle: string;
  impressions: number;
  clicks: number;
  ctr: string;
}

export interface PlanGates {
  enoughTraffic: boolean;
  leaderImpressions: number;
  minImpressions: number;
  oneClearlyAhead: boolean;
  probabilityBest: number;
  threshold: number;
  gapWorthMoney: boolean;
  holdsUpToRepeatedLooks: boolean;
  eValue: number;
  evidenceTarget: number;
  allOpen: boolean;
  blocking: string | null;
}

export interface PlanMandate {
  chargeable: number;
  remaining: string;
  note: string;
}

export interface PlanSnapshot {
  cycle: number;
  cyclesLeft: number;
  productName: string | null;
  productPrice: string | null;
  researchSources: number;
  generation: number | null;
  cohortSize: number;
  cohortImpressions: number;
  arms: PlanArm[];
  gates: PlanGates | null;
  credits: number;
  creditPrice: string;
  mandate: PlanMandate;
  lastDecision: string | null;
  lastPurchase: string | null;
  progress: PlanProgress;
  history: string[];
}

export interface PlanChoice {
  action: PlanAction;
  reason: string;
  impressions: number | null;
}

export interface PlanResult {
  choice: PlanChoice;
  source: "model" | "fallback";
  fallbackBecause: string | null;
  snapshot: PlanSnapshot;
  tookMs: number;
}

export function isPlanAction(value: unknown): value is PlanAction {
  return typeof value === "string" && (PLAN_ACTIONS as readonly string[]).includes(value);
}

export function clampImpressions(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PLAN_IMPRESSIONS;
  return Math.min(MAX_PLAN_IMPRESSIONS, Math.max(MIN_PLAN_IMPRESSIONS, Math.round(n)));
}

export function liveCohort(state: State): Creative[] {
  if (state.creatives.length === 0) return [];
  const generation = Math.max(...state.creatives.map((c) => c.generation));
  return state.creatives.filter((c) => c.generation === generation);
}

function rate(impressions: number, clicks: number): string {
  if (!impressions) return "0.00%";
  return `${((clicks / impressions) * 100).toFixed(2)}%`;
}

export function readGates(cohort: Creative[]): PlanGates | null {
  if (cohort.length === 0) return null;
  const verdict = evaluate(
    cohort.map((c) => c.arm),
    { samples: 20000, candidateRule: "probabilityBest", rng: createRng(cohortSeed(cohort)) },
  );
  const enoughTraffic = verdict.minImpressionsMet;
  const oneClearlyAhead = verdict.thresholdMet;
  const gapWorthMoney = verdict.effectSizeOk;
  const holds = verdict.anytimeValid;
  const blocking = !enoughTraffic
    ? "Enough traffic"
    : !oneClearlyAhead
      ? "One ad clearly ahead"
      : !gapWorthMoney
        ? "The gap is worth money"
        : !holds
          ? "Holds up to repeated looks"
          : null;

  return {
    enoughTraffic,
    leaderImpressions: cohort[verdict.candidateIndex]?.arm.impressions ?? 0,
    minImpressions: DEFAULT_MIN_IMPRESSIONS,
    oneClearlyAhead,
    probabilityBest: verdict.probabilityBest,
    threshold: DEFAULT_THRESHOLD,
    gapWorthMoney,
    holdsUpToRepeatedLooks: holds,
    eValue: Number.isFinite(verdict.eValue) ? verdict.eValue : EVIDENCE_TARGET,
    evidenceTarget: EVIDENCE_TARGET,
    allOpen: verdict.sufficientEvidence,
    blocking,
  };
}

export function buildSnapshot(input: {
  state: State;
  cycle: number;
  progress: PlanProgress;
  history: string[];
  mandate: PlanMandate;
  creditPrice: string;
  lastDecision: string | null;
  lastPurchase: string | null;
}): PlanSnapshot {
  const cohort = liveCohort(input.state);
  return {
    cycle: input.cycle,
    cyclesLeft: Math.max(0, MAX_PLAN_CYCLES - input.cycle),
    productName: input.state.product?.name ?? null,
    productPrice: input.state.product?.price ?? null,
    researchSources: input.state.research?.sources.length ?? 0,
    generation: cohort[0]?.generation ?? null,
    cohortSize: cohort.length,
    cohortImpressions: cohort.reduce((sum, c) => sum + c.arm.impressions, 0),
    arms: cohort.map((c) => ({
      headline: c.headline,
      angle: c.angle,
      impressions: c.arm.impressions,
      clicks: c.arm.clicks,
      ctr: rate(c.arm.impressions, c.arm.clicks),
    })),
    gates: readGates(cohort),
    credits: input.state.credits.balance,
    creditPrice: input.creditPrice,
    mandate: input.mandate,
    lastDecision: input.lastDecision,
    lastPurchase: input.lastPurchase,
    progress: input.progress,
    history: input.history.slice(-12),
  };
}

function serveSize(snapshot: PlanSnapshot): number {
  if (snapshot.cohortImpressions === 0) return DEFAULT_PLAN_IMPRESSIONS;
  return clampImpressions(Math.max(DEFAULT_PLAN_IMPRESSIONS, snapshot.cohortImpressions));
}

export function scriptedNext(snapshot: PlanSnapshot): PlanChoice {
  const p = snapshot.progress;

  if (!snapshot.productName) {
    return {
      action: "stop",
      reason: "There is no product on the state, so the scripted order has nothing to run.",
      impressions: null,
    };
  }

  if (snapshot.researchSources === 0 && !p.researched) {
    return {
      action: "research",
      reason: "The scripted order starts with research because nothing has been read about this market yet.",
      impressions: null,
    };
  }

  if (snapshot.cohortSize === 0) {
    return {
      action: "creatives",
      reason: "The scripted order writes the four creatives next because there is no cohort to test.",
      impressions: null,
    };
  }

  if (p.purchased) {
    if (!p.evolved) {
      return {
        action: "evolve",
        reason: "The scripted order breeds the winner after a charge goes through.",
        impressions: null,
      };
    }
    if (!p.retested) {
      return {
        action: "serve_traffic",
        reason: "The scripted order retests the bred generation with one more block of traffic.",
        impressions: serveSize(snapshot),
      };
    }
    return {
      action: "stop",
      reason: "The scripted order is finished: researched, wrote, served, decided, spent, bred and retested.",
      impressions: null,
    };
  }

  if (p.purchaseAttempts > 0) {
    return {
      action: "stop",
      reason: "The charge was already attempted and did not go through, so the scripted order ends the run here.",
      impressions: null,
    };
  }

  if (snapshot.gates?.allOpen === true) {
    if (!p.decided) {
      return {
        action: "evaluate",
        reason: "The scripted order always reads the evidence and asks the model to justify the spend before charging anything.",
        impressions: null,
      };
    }
    return {
      action: "purchase",
      reason: "The four gates are open and the spend was justified, so the scripted order charges the mandate.",
      impressions: null,
    };
  }

  if (p.looksLeft <= 0) {
    return {
      action: "stop",
      reason: "The run is out of looks and the gates never opened, so the scripted order keeps the money.",
      impressions: null,
    };
  }

  if (snapshot.cohortImpressions === 0 || p.decided) {
    return {
      action: "serve_traffic",
      reason: "The scripted order serves another block of traffic because the gates are still shut.",
      impressions: serveSize(snapshot),
    };
  }

  return {
    action: "evaluate",
    reason: "The scripted order reads the evidence after every block of traffic.",
    impressions: null,
  };
}

function strengthOf(value: number): string {
  if (!Number.isFinite(value)) return "past anything the scale reports";
  if (value >= 1000) return "over 1,000";
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(2);
}

function gateLine(open: boolean, label: string, detail: string): string {
  return `  ${open ? "OPEN" : "SHUT"}  ${label}: ${detail}`;
}

export function renderSnapshot(s: PlanSnapshot): string {
  const lines: string[] = [];

  lines.push(`Cycle ${s.cycle} of ${MAX_PLAN_CYCLES}. Cycles left after this one: ${s.cyclesLeft}.`);
  lines.push("");
  lines.push(`Product: ${s.productName ?? "none submitted"}${s.productPrice ? ` at ${s.productPrice}` : ""}`);
  lines.push(
    s.researchSources > 0
      ? `Market research: done, ${s.researchSources} live sources cited.`
      : "Market research: not done. The creatives endpoint refuses to write anything without it.",
  );

  if (s.cohortSize === 0) {
    lines.push("Creatives: none written yet, so there is no cohort to serve traffic to.");
  } else {
    lines.push(`Creatives: generation ${s.generation}, ${s.cohortSize} variants under test.`);
    for (const a of s.arms) {
      lines.push(`  [${a.angle}] "${a.headline}" ${a.clicks}/${a.impressions} clicks (${a.ctr} CTR)`);
    }
    lines.push(`Impressions served on this generation: ${s.cohortImpressions}`);
  }

  lines.push("");
  if (!s.gates) {
    lines.push("The four gates: nothing to measure yet.");
  } else {
    lines.push("The four gates that have to open before any money moves:");
    lines.push(
      gateLine(
        s.gates.enoughTraffic,
        "Enough traffic",
        `leader has ${s.gates.leaderImpressions} impressions of the ${s.gates.minImpressions} needed`,
      ),
    );
    lines.push(
      gateLine(
        s.gates.oneClearlyAhead,
        "One ad clearly ahead",
        `probability best ${(s.gates.probabilityBest * 100).toFixed(1)}% against the ${(s.gates.threshold * 100).toFixed(0)}% bar`,
      ),
    );
    lines.push(
      gateLine(s.gates.gapWorthMoney, "The gap is worth money", "expected loss against the leader is inside tolerance"),
    );
    lines.push(
      gateLine(
        s.gates.holdsUpToRepeatedLooks,
        "Holds up to repeated looks",
        `evidence ${strengthOf(s.gates.eValue)} of the ${s.gates.evidenceTarget} needed`,
      ),
    );
    lines.push(
      s.gates.allOpen
        ? "All four gates are open."
        : `Still shut: ${s.gates.blocking}. The purchase route recomputes this on the server and refuses a charge while it is shut.`,
    );
  }

  lines.push("");
  lines.push(`Looks taken on this cohort: ${s.progress.looksTaken}. Looks left: ${s.progress.looksLeft}.`);
  lines.push(`Render credits in hand: ${s.credits}. A pack costs ${s.creditPrice} USD.`);
  lines.push(`Mandate: ${s.mandate.remaining}. ${s.mandate.note}`);
  if (s.lastDecision) lines.push(`Last spend decision: ${s.lastDecision}`);
  if (s.lastPurchase) lines.push(`Last charge attempt: ${s.lastPurchase}`);

  lines.push("");
  lines.push(
    `Already done this run: research ${s.progress.researched ? "yes" : "no"}, creatives ${s.progress.wrote ? "yes" : "no"}, spend decision ${s.progress.decided ? "yes" : "no"}, charge attempts ${s.progress.purchaseAttempts}, charge succeeded ${s.progress.purchased ? "yes" : "no"}, winner bred ${s.progress.evolved ? "yes" : "no"}, bred generation retested ${s.progress.retested ? "yes" : "no"}.`,
  );

  if (s.history.length) {
    lines.push("");
    lines.push("What you already did this run, in order:");
    for (const h of s.history) lines.push(`  ${h}`);
  }

  return lines.join("\n");
}
