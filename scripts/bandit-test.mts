import {
  evaluate,
  sampleBeta,
  simulateTraffic,
  createRng,
  type Arm,
  type Allocation,
  type EvaluateOptions,
} from "../lib/bandit.ts";

const RUNS = Number(process.env.RUNS ?? 200);
const MC = Number(process.env.MC ?? 20000);
const LEGACY_MC = Number(process.env.LEGACY_MC ?? 500);
const HORIZON = Number(process.env.HORIZON ?? 12000);
const THRESHOLD = 0.95;
const MIN_IMPRESSIONS = 200;

const LEGACY: EvaluateOptions = {
  samples: LEGACY_MC,
  threshold: THRESHOLD,
  minImpressions: MIN_IMPRESSIONS,
  candidateRule: "sample",
  priorAlpha: 1,
  priorBeta: 1,
};

const CURRENT: EvaluateOptions = {
  samples: MC,
  threshold: THRESHOLD,
  minImpressions: MIN_IMPRESSIONS,
};

function pct(x: number): string {
  return `${(100 * x).toFixed(1)}%`;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function wilson(hits: number, n: number): string {
  const p = hits / n;
  const z = 1.96;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return `[${pct(Math.max(0, centre - half))}, ${pct(Math.min(1, centre + half))}]`;
}

function freshArms(n: number): Arm[] {
  return Array.from({ length: n }, (_, i) => ({ id: `v${i}`, impressions: 0, clicks: 0 }));
}

function validateSampler() {
  console.log("== 1. beta sampler vs analytic moments (200k draws each) ==");
  const rng = createRng(12345);
  const cases: [number, number][] = [
    [0.5, 0.5],
    [0.5, 50.5],
    [30.5, 970.5],
    [201, 4801],
  ];
  for (const [a, b] of cases) {
    const n = 200000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = sampleBeta(a, b, rng);
      sum += x;
      sumSq += x * x;
    }
    const m = sum / n;
    const v = sumSq / n - m * m;
    const tm = a / (a + b);
    const tv = (a * b) / ((a + b) * (a + b) * (a + b + 1));
    console.log(
      `Beta(${a}, ${b})`.padEnd(20),
      `mean ${m.toExponential(4)} vs ${tm.toExponential(4)}`,
      ` z=${(Math.abs(m - tm) / Math.sqrt(tv / n)).toFixed(2)}`.padEnd(9),
      `var rel err ${((100 * Math.abs(v - tv)) / tv).toFixed(2)}%`,
    );
  }
  console.log("");
}

interface Outcome {
  fired: boolean;
  correct: boolean;
  impressionsAtFire: number;
}

interface PairedRun {
  legacy: Outcome;
  current: Outcome;
}

function pairedRun(
  rates: number[],
  bestIndex: number,
  seed: number,
  allocation: Allocation,
  looks: number,
  horizon: number,
): PairedRun {
  const trafficRng = createRng(seed);
  const legacyRng = createRng(seed ^ 0x9e3779b9);
  const currentRng = createRng(seed ^ 0x85ebca6b);
  let arms = freshArms(rates.length);
  const legacy: Outcome = { fired: false, correct: false, impressionsAtFire: horizon };
  const current: Outcome = { fired: false, correct: false, impressionsAtFire: horizon };
  const step = Math.floor(horizon / looks);

  for (let look = 1; look <= looks; look++) {
    arms = simulateTraffic(arms, rates, step, trafficRng, allocation);

    if (!legacy.fired) {
      const res = evaluate(arms, { ...LEGACY, rng: legacyRng });
      if (res.thresholdMet && res.minImpressionsMet) {
        legacy.fired = true;
        legacy.correct = res.candidateIndex === bestIndex;
        legacy.impressionsAtFire = res.totalImpressions;
      }
    }
    if (!current.fired) {
      const res = evaluate(arms, { ...CURRENT, rng: currentRng });
      if (res.sufficientEvidence) {
        current.fired = true;
        current.correct = res.candidateIndex === bestIndex;
        current.impressionsAtFire = res.totalImpressions;
      }
    }
    if (legacy.fired && current.fired) break;
  }
  return { legacy, current };
}

function summarize(label: string, outcomes: Outcome[], bestIndex: number) {
  const fired = outcomes.filter((o) => o.fired);
  const correct = fired.filter((o) => o.correct);
  const stops = fired.map((o) => o.impressionsAtFire);
  console.log(
    label.padEnd(26),
    `fired ${pct(fired.length / outcomes.length).padStart(6)} ${wilson(fired.length, outcomes.length).padEnd(18)}`,
    bestIndex >= 0
      ? `true best ${pct(fired.length ? correct.length / fired.length : 0).padStart(6)} of fires`
      : "".padEnd(27),
    stops.length ? `med stop ${String(quantile(stops, 0.5)).padStart(6)}` : "",
  );
}

function comparison(
  title: string,
  rates: number[],
  bestIndex: number,
  allocation: Allocation,
  looks: number,
  seedBase: number,
  horizon: number = HORIZON,
) {
  const legacy: Outcome[] = [];
  const current: Outcome[] = [];
  for (let r = 0; r < RUNS; r++) {
    const res = pairedRun(rates, bestIndex, seedBase + r * 7919, allocation, looks, horizon);
    legacy.push(res.legacy);
    current.push(res.current);
  }
  console.log(title);
  summarize("  old rule", legacy, bestIndex);
  summarize("  new rule", current, bestIndex);
  return {
    legacyRate: legacy.filter((o) => o.fired).length / RUNS,
    currentRate: current.filter((o) => o.fired).length / RUNS,
    legacyCorrect: legacy.filter((o) => o.fired && o.correct).length / RUNS,
    currentCorrect: current.filter((o) => o.fired && o.correct).length / RUNS,
  };
}

function boundaryDataset(): Arm[] {
  const base = 1000;
  for (let c = 30; c < 120; c++) {
    const arms: Arm[] = [
      { impressions: base, clicks: 30 },
      { impressions: base, clicks: 30 },
      { impressions: base, clicks: 30 },
      { impressions: base, clicks: c },
    ];
    const res = evaluate(arms, { samples: 200000, rng: createRng(4242) });
    if (res.probabilityBest > 0.94) return arms;
  }
  return [];
}

function main() {
  const t0 = Date.now();
  console.log(
    `runs=${RUNS} mc=${MC} legacyMc=${LEGACY_MC} horizon=${HORIZON} threshold=${THRESHOLD} minImpressions=${MIN_IMPRESSIONS}`,
  );
  console.log("old rule : Beta(c+1, f+1), candidateRule=sample, gate = P(best) > 0.95 only");
  console.log(
    "new rule : Jeffreys prior, candidateRule=probabilityBest, gate = P(best) > 0.95 AND expectedLoss < 1% AND eValue >= 20",
  );
  console.log("");

  validateSampler();

  console.log("== 2. null scenario: 4 arms all at 3.0 pct, even allocation ==");
  const null4 = [0.03, 0.03, 0.03, 0.03];
  const nullTable: [number, number, number][] = [];
  for (const looks of [1, 8, 48]) {
    const r = comparison(`looks=${String(looks).padStart(2)}`, null4, -1, "even", looks, 3000);
    nullTable.push([looks, r.legacyRate, r.currentRate]);
    console.log("");
  }

  console.log("== 3. null scenario: 2 arms both at 3.0 pct, even allocation ==");
  const nullTable2: [number, number, number][] = [];
  for (const looks of [1, 8, 48]) {
    const r = comparison(`looks=${String(looks).padStart(2)}`, [0.03, 0.03], -1, "even", looks, 4000);
    nullTable2.push([looks, r.legacyRate, r.currentRate]);
    console.log("");
  }

  console.log("== 4. known truth 2 / 3 / 4 / 6 pct, thompson allocation ==");
  const truth = [0.02, 0.03, 0.04, 0.06];
  const power: [number, number, number, number, number][] = [];
  for (const looks of [1, 8, 48]) {
    const r = comparison(`looks=${String(looks).padStart(2)}`, truth, 3, "thompson", looks, 1000);
    power.push([looks, r.legacyRate, r.currentRate, r.legacyCorrect, r.currentCorrect]);
    console.log("");
  }
  console.log(`horizon=48000, looks=48`);
  const longRun = comparison("", truth, 3, "thompson", 48, 1000, 48000);
  console.log("");

  console.log("== 5. monte carlo noise on one fixed dataset sitting on the threshold ==");
  const boundary = boundaryDataset();
  console.log("  arms", boundary.map((a) => `${a.clicks}/${a.impressions}`).join("  "));
  for (const n of [LEGACY_MC, MC]) {
    const ps: number[] = [];
    let fires = 0;
    for (let i = 0; i < 200; i++) {
      const res = evaluate(boundary, { ...CURRENT, samples: n, rng: createRng(90000 + i * 31) });
      ps.push(res.probabilityBest);
      if (res.thresholdMet) fires++;
    }
    const m = mean(ps);
    const sd = Math.sqrt(mean(ps.map((p) => (p - m) * (p - m))));
    console.log(
      `  N=${String(n).padStart(6)}`,
      `mean P=${m.toFixed(4)}`,
      `mc sd=${sd.toFixed(4)}`,
      `cleared 0.95 in ${String(fires).padStart(3)}/200 reruns of identical data`,
    );
  }
  console.log("");

  console.log("== 6. prior bias at low ctr ==");
  for (const [pa, pb, name] of [
    [1, 1, "uniform Beta(1,1)"],
    [0.5, 0.5, "jeffreys Beta(.5,.5)"],
  ] as [number, number, string][]) {
    const zero = (0 + pa) / (50 + pa + pb);
    const one = (1 + pa) / (50 + pa + pb);
    console.log(
      `  ${name.padEnd(22)} 0 clicks / 50 imps -> ${pct(zero)}   1 click / 50 imps -> ${pct(one)}`,
    );
  }
  console.log("");

  console.log("== 7. gate breakdown on fixed datasets ==");
  const shown: { label: string; arms: Arm[] }[] = [
    {
      label: "clear winner",
      arms: [
        { impressions: 4000, clicks: 80 },
        { impressions: 4000, clicks: 240 },
      ],
    },
    {
      label: "tie         ",
      arms: [
        { impressions: 4000, clicks: 120 },
        { impressions: 4000, clicks: 124 },
      ],
    },
    {
      label: "thin data   ",
      arms: [
        { impressions: 220, clicks: 3 },
        { impressions: 220, clicks: 12 },
      ],
    },
  ];
  for (const s of shown) {
    const res = evaluate(s.arms, { ...CURRENT, rng: createRng(777) });
    console.log(
      `  ${s.label}`,
      `P=${res.probabilityBest.toFixed(4)}`,
      `loss=${res.expectedLoss.toExponential(2)}`,
      `eValue=${res.eValue.toExponential(2)}`,
      `[p ${res.thresholdMet ? "y" : "n"} | eff ${res.effectSizeOk ? "y" : "n"} | av ${res.anytimeValid ? "y" : "n"}]`,
      `-> ${res.sufficientEvidence ? "FIRE" : "hold"}`,
    );
  }
  console.log("");

  console.log("== summary: false positive rate under the null, all arms at 3.0 pct ==");
  console.log("  looks    old rule    new rule    arms");
  for (const [looks, o, n] of nullTable) {
    console.log(
      `  ${String(looks).padStart(5)}    ${pct(o).padStart(8)}    ${pct(n).padStart(8)}    K=4`,
    );
  }
  for (const [looks, o, n] of nullTable2) {
    console.log(
      `  ${String(looks).padStart(5)}    ${pct(o).padStart(8)}    ${pct(n).padStart(8)}    K=2`,
    );
  }
  console.log("");
  console.log("== summary: detection of the true best arm, truth 2 / 3 / 4 / 6 pct ==");
  console.log("  looks    old fires   new fires   old right   new right");
  for (const [looks, o, n, oc, nc] of power) {
    console.log(
      `  ${String(looks).padStart(5)}    ${pct(o).padStart(9)}   ${pct(n).padStart(9)}   ${pct(oc).padStart(9)}   ${pct(nc).padStart(9)}`,
    );
  }
  console.log(
    `  ${String(48).padStart(5)}    ${pct(longRun.legacyRate).padStart(9)}   ${pct(longRun.currentRate).padStart(9)}   ${pct(longRun.legacyCorrect).padStart(9)}   ${pct(longRun.currentCorrect).padStart(9)}   horizon 48000`,
  );
  console.log("");
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
