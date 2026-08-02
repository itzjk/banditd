import { createRng, evaluate, type Arm } from "../lib/bandit.ts";
import { cohortSeed } from "../lib/cohort-seed.ts";
import type { Round } from "../lib/state-schema.ts";

export const REPLAY_SAMPLES = 20000;
export const REPLAY_LIMIT = 60;

export interface ReplayCreative {
  id: string;
  label: string;
}

export interface ReplayArm {
  id: string;
  label: string;
  impressions: number;
  clicks: number;
  rate: number;
}

export interface RuleLook {
  candidate: number;
  probabilityBest: number;
  ready: boolean;
}

export interface ReplayLook {
  n: number;
  served: number;
  naive: RuleLook;
  gated: RuleLook & { eValue: number };
}

export interface RuleCall {
  look: number;
  served: number;
  candidate: number;
  probabilityBest: number;
  candidateImpressions: number;
  candidateRate: number;
}

export type ReplayStatus = "no-run" | "thin" | "ready";

export interface Replay {
  status: ReplayStatus;
  generation: number;
  looks: ReplayLook[];
  arms: ReplayArm[];
  naive: RuleCall | null;
  gated: RuleCall | null;
  gap: number | null;
  truncated: boolean;
}

export type VerdictKind =
  | "none"
  | "naive-only"
  | "gated-only"
  | "same-pick"
  | "split-worse"
  | "split-better"
  | "split-level";

export interface Verdict {
  kind: VerdictKind;
  tone: "caught" | "agreed" | "against" | "open";
  headline: string;
  detail: string;
}

function rateOf(impressions: number, clicks: number): number {
  return impressions > 0 ? clicks / impressions : 0;
}

function shown(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function percent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(digits)}%`;
}

function seedOf(ids: string[], arms: Arm[]): number {
  return cohortSeed(ids.map((id, i) => ({ id, arm: arms[i] })));
}

function alignedArms(round: Round, ids: string[]): Arm[] | null {
  const byId = new Map(round.arms.map((a) => [a.id, a]));
  const arms: Arm[] = [];
  for (const id of ids) {
    const found = byId.get(id);
    if (!found) return null;
    arms.push({ id, impressions: found.impressions, clicks: found.clicks });
  }
  return arms;
}

export function replayRun(
  rounds: Round[],
  cohort: ReplayCreative[],
  generation: number,
): Replay {
  const empty: Replay = {
    status: "no-run",
    generation,
    looks: [],
    arms: [],
    naive: null,
    gated: null,
    gap: null,
    truncated: false,
  };
  if (cohort.length < 2) return empty;

  const ids = cohort.map((c) => c.id);
  const history: Arm[][] = [];
  for (const round of rounds) {
    if (round.generation !== generation) continue;
    const arms = alignedArms(round, ids);
    if (!arms) continue;
    if (arms.reduce((sum, a) => sum + a.impressions, 0) === 0) continue;
    history.push(arms);
  }
  if (history.length === 0) return empty;

  const truncated = history.length > REPLAY_LIMIT;
  const kept = truncated ? history.slice(0, REPLAY_LIMIT) : history;
  if (kept.length < 2) return { ...empty, status: "thin", truncated };

  const looks: ReplayLook[] = [];
  let naive: RuleCall | null = null;
  let gated: RuleCall | null = null;

  for (let index = 0; index < kept.length; index++) {
    const arms = kept[index];
    const seed = seedOf(ids, arms);
    const served = arms.reduce((sum, a) => sum + a.impressions, 0);

    const read = evaluate(arms, {
      samples: REPLAY_SAMPLES,
      candidateRule: "probabilityBest",
      rng: createRng(seed),
    });

    const naiveReady = read.thresholdMet && read.minImpressionsMet;
    const gatedReady = read.sufficientEvidence;
    const call: RuleLook = {
      candidate: read.candidateIndex,
      probabilityBest: read.probabilityBest,
      ready: naiveReady,
    };

    looks.push({
      n: index + 1,
      served,
      naive: call,
      gated: { ...call, ready: gatedReady, eValue: read.eValue },
    });

    const arm = arms[read.candidateIndex];
    const made: RuleCall = {
      look: index + 1,
      served,
      candidate: read.candidateIndex,
      probabilityBest: read.probabilityBest,
      candidateImpressions: arm.impressions,
      candidateRate: rateOf(arm.impressions, arm.clicks),
    };

    if (!naive && naiveReady) naive = made;
    if (!gated && gatedReady) gated = made;
  }

  const last = kept[kept.length - 1];
  const arms: ReplayArm[] = last.map((arm, i) => ({
    id: ids[i],
    label: cohort[i].label,
    impressions: arm.impressions,
    clicks: arm.clicks,
    rate: rateOf(arm.impressions, arm.clicks),
  }));

  return {
    status: "ready",
    generation,
    looks,
    arms,
    naive,
    gated,
    gap: naive && gated ? gated.served - naive.served : null,
    truncated,
  };
}

function timing(replay: Replay): string {
  const { naive, gated, gap } = replay;
  if (!naive || !gated || gap === null) return "";
  if (gap > 0) {
    return `It would have called it on look ${naive.look}, ${shown(gap)} impressions before we called ours on look ${gated.look}.`;
  }
  if (gap < 0) {
    return `It would have called it on look ${naive.look}, ${shown(-gap)} impressions after we called ours on look ${gated.look}.`;
  }
  return `Both rules called it on the same look, number ${naive.look}.`;
}

export function verdictOf(replay: Replay): Verdict {
  const { naive, gated, looks, arms } = replay;
  const total = looks.length;

  if (!naive && !gated) {
    return {
      kind: "none",
      tone: "open",
      headline: `Neither rule called a winner across ${total} ${total === 1 ? "look" : "looks"}.`,
      detail:
        "The common rule never got one ad past 95%, and our gates never opened either. On this run there is nothing to separate them.",
    };
  }

  if (naive && !gated) {
    const pick = arms[naive.candidate];
    return {
      kind: "naive-only",
      tone: "caught",
      headline: `The common rule would have crowned ${pick?.label ?? "an ad"} on look ${naive.look}. We never called a winner at all.`,
      detail: `It stopped at ${shown(naive.served)} impressions on ${percent(naive.probabilityBest, 1)} sure. Our gates stayed shut for the remaining ${total - naive.look} ${total - naive.look === 1 ? "look" : "looks"}, so no money moved on that call.`,
    };
  }

  if (!naive && gated) {
    const pick = arms[gated.candidate];
    return {
      kind: "gated-only",
      tone: "against",
      headline: `We called ${pick?.label ?? "an ad"} on look ${gated.look}. The common rule never reached its own bar.`,
      detail: `Our four gates opened at ${shown(gated.served)} impressions. The common rule stayed under 95% on every one of the ${total} looks, so on this run it was the slower of the two.`,
    };
  }

  if (!naive || !gated) {
    return {
      kind: "none",
      tone: "open",
      headline: "Nothing to compare yet.",
      detail: "Run the demo to give both rules the same traffic to read.",
    };
  }

  const naivePick = arms[naive.candidate];
  const gatedPick = arms[gated.candidate];

  if (naive.candidate === gated.candidate) {
    return {
      kind: "same-pick",
      tone: "agreed",
      headline: `Both rules landed on the same ad, ${naivePick?.label ?? "the leader"}.`,
      detail: `${timing(replay)} The common rule was right here, and saying so is the point: it usually is. What it cannot tell you is which runs are the other kind.`,
    };
  }

  const naiveRate = naivePick?.rate ?? 0;
  const gatedRate = gatedPick?.rate ?? 0;
  const spread = naiveRate - gatedRate;
  const meaningful = Math.abs(spread) >= 0.0005;

  if (!meaningful) {
    return {
      kind: "split-level",
      tone: "open",
      headline: `The two rules picked different ads, ${naivePick?.label ?? "one"} against ${gatedPick?.label ?? "the other"}.`,
      detail: `${timing(replay)} By the last look the two were level, ${percent(naiveRate)} against ${percent(gatedRate)}, so this run does not settle which pick was better.`,
    };
  }

  if (spread < 0) {
    return {
      kind: "split-worse",
      tone: "caught",
      headline: `The common rule would have crowned ${naivePick?.label ?? "another ad"}, which ended behind the ad we picked.`,
      detail: `${timing(replay)} By the last look its pick was clicking at ${percent(naiveRate)} against our ${percent(gatedRate)}. That is a false winner caught on this run's own numbers.`,
    };
  }

  return {
    kind: "split-better",
    tone: "against",
    headline: `The common rule would have crowned ${naivePick?.label ?? "another ad"}, which ended ahead of the ad we picked.`,
    detail: `${timing(replay)} By the last look its pick was clicking at ${percent(naiveRate)} against our ${percent(gatedRate)}. On this run the caution cost us, and the panel says so rather than hiding it.`,
  };
}
