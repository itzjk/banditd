import {
  evaluate,
  sampleBeta,
  simulateTraffic,
  createRng,
  type Arm,
  type CandidateRule,
  type Allocation,
} from "../lib/bandit.ts";

const RUNS = Number(process.env.RUNS ?? 400);
const MC = Number(process.env.MC ?? 4000);
const HORIZON = Number(process.env.HORIZON ?? 12000);
const THRESHOLD = 0.95;
const MIN_IMPRESSIONS = 200;

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
    [1, 1],
    [3, 7],
    [0.5, 0.5],
    [0.05, 0.05],
    [201, 4801],
    [1, 100000],
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
      `Beta(${a}, ${b})`.padEnd(18),
      `mean ${m.toExponential(4)} vs ${tm.toExponential(4)}`,
      ` z=${(Math.abs(m - tm) / Math.sqrt(tv / n)).toFixed(2)}`.padEnd(9),
      `var rel err ${(100 * Math.abs(v - tv) / tv).toFixed(2)}%`,
    );
  }
  console.log("");
}

interface RunResult {
  fired: boolean;
  correct: boolean;
  impressionsAtFire: number;
}

function sequentialRun(
  rates: number[],
  bestIndex: number,
  seed: number,
  rule: CandidateRule,
  allocation: Allocation,
  looks: number,
): RunResult {
  const trafficRng = createRng(seed);
  const evalRng = createRng(seed ^ 0x9e3779b9);
  let arms = freshArms(rates.length);
  const step = Math.floor(HORIZON / looks);
  for (let look = 1; look <= looks; look++) {
    arms = simulateTraffic(arms, rates, step, trafficRng, allocation);
    const res = evaluate(arms, {
      samples: MC,
      threshold: THRESHOLD,
      minImpressions: MIN_IMPRESSIONS,
      candidateRule: rule,
      rng: evalRng,
    });
    if (res.sufficientEvidence) {
      return {
        fired: true,
        correct: res.candidateIndex === bestIndex,
        impressionsAtFire: res.totalImpressions,
      };
    }
  }
  return { fired: false, correct: false, impressionsAtFire: HORIZON };
}

function scenario(
  label: string,
  rates: number[],
  bestIndex: number,
  rule: CandidateRule,
  allocation: Allocation,
  looks: number,
  seedBase: number,
) {
  const results: RunResult[] = [];
  for (let r = 0; r < RUNS; r++) {
    results.push(sequentialRun(rates, bestIndex, seedBase + r * 7919, rule, allocation, looks));
  }
  const fired = results.filter((r) => r.fired);
  const correct = fired.filter((r) => r.correct);
  const stops = fired.map((r) => r.impressionsAtFire);
  console.log(
    label.padEnd(30),
    `fired ${pct(fired.length / RUNS).padStart(6)} ${wilson(fired.length, RUNS).padEnd(18)}`,
    bestIndex >= 0
      ? `picked true best ${pct(fired.length ? correct.length / fired.length : 0).padStart(6)} of fires`
      : "".padEnd(33),
    stops.length ? `med stop ${String(quantile(stops, 0.5)).padStart(6)}` : "",
  );
}

function boundaryDataset(): Arm[] {
  const base = 1000;
  for (let c = 30; c < 90; c++) {
    const arms: Arm[] = [
      { impressions: base, clicks: 30 },
      { impressions: base, clicks: 30 },
      { impressions: base, clicks: 30 },
      { impressions: base, clicks: c },
    ];
    const res = evaluate(arms, {
      samples: 200000,
      candidateRule: "probabilityBest",
      rng: createRng(4242),
    });
    if (res.probabilityBest > 0.94) return arms;
  }
  return [];
}

function main() {
  const t0 = Date.now();
  console.log(
    `runs=${RUNS} mc=${MC} horizon=${HORIZON} threshold=${THRESHOLD} minImpressions=${MIN_IMPRESSIONS}`,
  );
  console.log("");

  validateSampler();

  const truth = [0.02, 0.03, 0.04, 0.06];

  console.log("== 2. known truth 2 / 3 / 4 / 6 pct, thompson allocation, 24 looks ==");
  scenario("spec rule (sample)", truth, 3, "sample", "thompson", 24, 1000);
  scenario("argmax P(best)", truth, 3, "probabilityBest", "thompson", 24, 1000);
  scenario("argmax posterior mean", truth, 3, "posteriorMean", "thompson", 24, 1000);
  console.log("");

  console.log("== 3. hard truth 3 / 3 / 3 / 3.6 pct, even allocation, 24 looks ==");
  const hard = [0.03, 0.03, 0.03, 0.036];
  scenario("spec rule (sample)", hard, 3, "sample", "even", 24, 2000);
  scenario("argmax P(best)", hard, 3, "probabilityBest", "even", 24, 2000);
  console.log("");

  console.log("== 4. null: 4 arms all at 3.0 pct, even allocation, same data per row ==");
  const null4 = [0.03, 0.03, 0.03, 0.03];
  for (const looks of [1, 2, 4, 8, 24, 48]) {
    scenario(`peeks=${String(looks).padStart(2)} spec rule`, null4, -1, "sample", "even", looks, 3000);
  }
  scenario("peeks=24 argmax P(best)", null4, -1, "probabilityBest", "even", 24, 3000);
  scenario("peeks=24 thompson alloc", null4, -1, "sample", "thompson", 24, 3000);
  console.log("");

  console.log("== 5. null: 2 arms both at 3.0 pct, even allocation ==");
  const null2 = [0.03, 0.03];
  for (const looks of [1, 2, 4, 8, 24, 48]) {
    scenario(`peeks=${String(looks).padStart(2)} K=2`, null2, -1, "sample", "even", looks, 4000);
  }
  console.log("");

  const boundary = boundaryDataset();
  console.log("== 6. one fixed dataset sitting on the threshold ==");
  console.log("arms", boundary.map((a) => `${a.clicks}/${a.impressions}`).join("  "));

  for (const n of [500, 2000, 8000, 50000]) {
    const ps: number[] = [];
    let fires = 0;
    for (let i = 0; i < 200; i++) {
      const res = evaluate(boundary, {
        samples: n,
        threshold: THRESHOLD,
        minImpressions: MIN_IMPRESSIONS,
        candidateRule: "probabilityBest",
        rng: createRng(90000 + i * 31),
      });
      ps.push(res.probabilityBest);
      if (res.sufficientEvidence) fires++;
    }
    const m = mean(ps);
    const sd = Math.sqrt(mean(ps.map((p) => (p - m) * (p - m))));
    console.log(
      `  N=${String(n).padStart(6)}`,
      `mean P=${m.toFixed(4)}`,
      `mc sd=${sd.toFixed(4)}`,
      `fired ${String(fires).padStart(3)}/200 on byte-identical data`,
    );
  }

  let agree = 0;
  let specFires = 0;
  let argmaxFires = 0;
  for (let i = 0; i < 400; i++) {
    const rng = createRng(500000 + i * 17);
    const spec = evaluate(boundary, {
      samples: 20000,
      threshold: THRESHOLD,
      minImpressions: MIN_IMPRESSIONS,
      candidateRule: "sample",
      rng,
    });
    const best = evaluate(boundary, {
      samples: 20000,
      threshold: THRESHOLD,
      minImpressions: MIN_IMPRESSIONS,
      candidateRule: "probabilityBest",
      rng: createRng(500000 + i * 17),
    });
    if (spec.candidateIndex === best.candidateIndex) agree++;
    if (spec.sufficientEvidence) specFires++;
    if (best.sufficientEvidence) argmaxFires++;
  }
  console.log(`  candidate agreement spec vs argmax P : ${pct(agree / 400)} of 400 evaluations`);
  console.log(`  fired under spec rule                : ${specFires}/400`);
  console.log(`  fired under argmax P(best)           : ${argmaxFires}/400`);
  console.log("");
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
