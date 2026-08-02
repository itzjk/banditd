import {
  evaluate,
  sampleBeta,
  simulateTraffic,
  createRng,
  logGamma,
  logMixtureBayesFactor,
  logCohortBayesFactor,
  DEFAULT_EVIDENCE_CONCENTRATION,
  EVIDENCE_CALIBRATION,
  type Arm,
  type Allocation,
  type EvaluateOptions,
} from "../lib/bandit.ts";

const RUNS = Number(process.env.RUNS ?? 200);
const MC = Number(process.env.MC ?? 20000);
const LEGACY_MC = Number(process.env.LEGACY_MC ?? 500);
const HORIZON = Number(process.env.HORIZON ?? 12000);
const POWER_RUNS = Number(process.env.POWER_RUNS ?? 150);
const POWER_LOOKS = Number(process.env.POWER_LOOKS ?? 12);
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

interface PowerOutcome {
  fired: boolean;
  correct: boolean;
  lostClicks: number;
}

interface PowerCell {
  base: number;
  lift: number;
  horizon: number;
  allocation: Allocation;
  legacy: { fire: number; right: number; loss: number };
  current: { fire: number; right: number; loss: number };
  holdLoss: number;
}

function expectedRegret(arms: Arm[], rates: number[], bestRate: number): number {
  let acc = 0;
  for (let k = 0; k < arms.length; k++) acc += arms[k].impressions * (bestRate - rates[k]);
  return acc;
}

function powerRun(
  rates: number[],
  bestIndex: number,
  seed: number,
  looks: number,
  horizon: number,
  allocation: Allocation,
): { legacy: PowerOutcome; current: PowerOutcome; holdLoss: number } {
  const bestRate = rates[bestIndex];
  const trafficRng = createRng(seed);
  const legacyRng = createRng(seed ^ 0x9e3779b9);
  const currentRng = createRng(seed ^ 0x85ebca6b);
  const step = Math.floor(horizon / looks);
  const span = step * looks;
  let arms = freshArms(rates.length);
  let legacyFire: { at: number; index: number; regret: number } | null = null;
  let currentFire: { at: number; index: number; regret: number } | null = null;

  for (let look = 1; look <= looks; look++) {
    arms = simulateTraffic(arms, rates, step, trafficRng, allocation);
    const served = step * look;
    if (!legacyFire) {
      const res = evaluate(arms, { ...LEGACY, rng: legacyRng });
      if (res.thresholdMet && res.minImpressionsMet) {
        legacyFire = {
          at: served,
          index: res.candidateIndex,
          regret: expectedRegret(arms, rates, bestRate),
        };
      }
    }
    if (!currentFire) {
      const res = evaluate(arms, { ...CURRENT, rng: currentRng });
      if (res.sufficientEvidence) {
        currentFire = {
          at: served,
          index: res.candidateIndex,
          regret: expectedRegret(arms, rates, bestRate),
        };
      }
    }
  }

  const holdLoss = expectedRegret(arms, rates, bestRate);
  const settle = (fire: typeof legacyFire): PowerOutcome =>
    fire
      ? {
          fired: true,
          correct: fire.index === bestIndex,
          lostClicks: fire.regret + (span - fire.at) * (bestRate - rates[fire.index]),
        }
      : { fired: false, correct: false, lostClicks: holdLoss };

  return { legacy: settle(legacyFire), current: settle(currentFire), holdLoss };
}

function powerCell(
  base: number,
  lift: number,
  horizon: number,
  allocation: Allocation,
  seedBase: number,
): PowerCell {
  const rates = [base, base * (1 + lift)];
  const legacy: PowerOutcome[] = [];
  const current: PowerOutcome[] = [];
  let holdLoss = 0;
  for (let r = 0; r < POWER_RUNS; r++) {
    const res = powerRun(rates, 1, seedBase + r * 7919, POWER_LOOKS, horizon, allocation);
    legacy.push(res.legacy);
    current.push(res.current);
    holdLoss += res.holdLoss;
  }
  const roll = (xs: PowerOutcome[]) => ({
    fire: xs.filter((o) => o.fired).length / xs.length,
    right: xs.filter((o) => o.correct).length / xs.length,
    loss: mean(xs.map((o) => o.lostClicks)),
  });
  return {
    base,
    lift,
    horizon,
    allocation,
    legacy: roll(legacy),
    current: roll(current),
    holdLoss: holdLoss / POWER_RUNS,
  };
}

function gapLabel(base: number, lift: number): string {
  return `${pct(base)} -> ${pct(base * (1 + lift))} (+${(100 * lift).toFixed(0)}%)`;
}

function powerCurve(allocation: Allocation): PowerCell[] {
  const cells: PowerCell[] = [];
  let seed = allocation === "even" ? 20000 : 60000;
  const grid: [number, number[]][] = [
    [0.03, [0.1, 0.2, 1 / 3, 1]],
    [0.01, [0.3]],
  ];
  for (const [base, lifts] of grid) {
    for (const lift of lifts) {
      for (const horizon of [12000, 48000, 200000]) {
        const cell = powerCell(base, lift, horizon, allocation, seed);
        seed += 104729;
        cells.push(cell);
        console.log(
          `  ${gapLabel(base, lift).padEnd(21)}`,
          `n=${String(horizon).padStart(6)}`,
          `| old fires ${pct(cell.legacy.fire).padStart(6)} right ${pct(cell.legacy.right).padStart(6)} lost ${cell.legacy.loss.toFixed(1).padStart(7)}`,
          `| new fires ${pct(cell.current.fire).padStart(6)} right ${pct(cell.current.right).padStart(6)} lost ${cell.current.loss.toFixed(1).padStart(7)}`,
          `| never commits lost ${cell.holdLoss.toFixed(1).padStart(7)}`,
        );
      }
    }
  }
  return cells;
}

const ALPHAS = [0.05, 0.1, 0.2, 0.5];

function alphaSweep(
  label: string,
  rates: number[],
  bestIndex: number,
  horizon: number,
  allocation: Allocation,
  seedBase: number,
) {
  const bestRate = rates[bestIndex];
  const step = Math.floor(horizon / POWER_LOOKS);
  const span = step * POWER_LOOKS;
  const outcomes = ALPHAS.map<PowerOutcome[]>(() => []);
  const peakE: number[] = [];

  for (let r = 0; r < POWER_RUNS; r++) {
    const seed = seedBase + r * 7919;
    const trafficRng = createRng(seed);
    const currentRng = createRng(seed ^ 0x85ebca6b);
    let arms = freshArms(rates.length);
    const fires = ALPHAS.map<{ at: number; index: number; regret: number } | null>(() => null);
    let peak = 0;

    for (let look = 1; look <= POWER_LOOKS; look++) {
      arms = simulateTraffic(arms, rates, step, trafficRng, allocation);
      const res = evaluate(arms, { ...CURRENT, rng: currentRng });
      if (res.eValue > peak) peak = res.eValue;
      const preconditions = res.thresholdMet && res.minImpressionsMet && res.effectSizeOk;
      for (let a = 0; a < ALPHAS.length; a++) {
        if (fires[a] || !preconditions || res.eValue < 1 / ALPHAS[a]) continue;
        fires[a] = {
          at: step * look,
          index: res.candidateIndex,
          regret: expectedRegret(arms, rates, bestRate),
        };
      }
    }

    const holdLoss = expectedRegret(arms, rates, bestRate);
    peakE.push(peak);
    for (let a = 0; a < ALPHAS.length; a++) {
      const fire = fires[a];
      outcomes[a].push(
        fire
          ? {
              fired: true,
              correct: fire.index === bestIndex,
              lostClicks: fire.regret + (span - fire.at) * (bestRate - rates[fire.index]),
            }
          : { fired: false, correct: false, lostClicks: holdLoss },
      );
    }
  }

  console.log(
    `  ${label}  peak e-value over the run: median ${quantile(peakE, 0.5).toExponential(2)}  p90 ${quantile(peakE, 0.9).toExponential(2)}`,
  );
  for (let a = 0; a < ALPHAS.length; a++) {
    const xs = outcomes[a];
    const fired = xs.filter((o) => o.fired).length;
    const right = xs.filter((o) => o.correct).length;
    console.log(
      `    alpha=${ALPHAS[a].toFixed(2)} bar=${String(Math.round(1 / ALPHAS[a])).padStart(2)}`,
      `fires ${pct(fired / xs.length).padStart(6)}`,
      `right ${pct(right / xs.length).padStart(6)}`,
      `lost ${mean(xs.map((o) => o.lostClicks)).toFixed(1).padStart(7)}`,
    );
  }
}

function priorScaleTable() {
  console.log(
    "== 10. the prior inside the bayes factor, two arms at n=24000 each, effect in sd of the difference ==",
  );
  console.log("  the number is the bayes factor before the calibration divide");
  console.log("  base     sd   old Beta(.5,.5)   old Beta(3,97)   cohort prior");
  for (const base of [0.005, 0.03, 0.2, 0.5]) {
    for (const z of [0, 3, 5]) {
      const n = 24000;
      const se = Math.sqrt((2 * base * (1 - base)) / n);
      const arms: Arm[] = [
        { impressions: n, clicks: Math.round(n * base) },
        { impressions: n, clicks: Math.round(n * (base + z * se)) },
      ];
      console.log(
        `  ${pct(base).padStart(6)}  ${z}  `,
        [
          logMixtureBayesFactor(arms, 0.5, 0.5),
          logMixtureBayesFactor(arms, 3, 97),
          logCohortBayesFactor(arms),
        ]
          .map((x) => Math.exp(x).toExponential(2).padStart(15))
          .join(" "),
      );
    }
  }
  console.log("");
}

function logBinomPmf(n: number, k: number, p: number): number {
  return (
    logGamma(n + 1) -
    logGamma(k + 1) -
    logGamma(n - k + 1) +
    k * Math.log(p) +
    (n - k) * Math.log(1 - p)
  );
}

function pointNullExpectation(n1: number, n2: number, p: number): number {
  const build = (n: number) => {
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    const lo = Math.max(0, Math.floor(mean - 11 * sd - 6));
    const hi = Math.min(n, Math.ceil(mean + 11 * sd + 6));
    const w: number[] = [];
    for (let c = lo; c <= hi; c++) w.push(Math.exp(logBinomPmf(n, c, p)));
    return { lo, w };
  };
  const a = build(n1);
  const b = build(n2);
  let acc = 0;
  for (let i = 0; i < a.w.length; i++) {
    if (a.w[i] < 1e-14) continue;
    for (let j = 0; j < b.w.length; j++) {
      const w = a.w[i] * b.w[j];
      if (w < 1e-15) continue;
      acc +=
        w *
        Math.exp(
          logCohortBayesFactor([
            { impressions: n1, clicks: a.lo + i },
            { impressions: n2, clicks: b.lo + j },
          ]),
        );
    }
  }
  return acc;
}

function calibrationTable() {
  console.log("== 11. is the e-value an e-value, exact enumeration over both arms under a point null ==");
  console.log("  an e-variable has expectation at most 1, so every cell after the divide must be at or below 1");
  console.log("  n1/n2         base    raw bayes factor   after divide");
  const sizes: [number, number][] = [
    [200, 200],
    [500, 500],
    [2000, 2000],
    [300, 4000],
    [200, 8000],
  ];
  let worst = 0;
  for (const [n1, n2] of sizes) {
    for (const p of [0.001, 0.004, 0.02, 0.12, 0.5]) {
      if (n1 * p > 900 || n2 * p > 900) continue;
      const raw = pointNullExpectation(n1, n2, p);
      if (raw > worst) worst = raw;
      console.log(
        `  ${String(n1).padStart(5)}/${String(n2).padEnd(5)} ${pct(p).padStart(7)}   ${raw.toFixed(4).padStart(16)}   ${(raw / EVIDENCE_CALIBRATION).toFixed(4).padStart(12)}`,
      );
    }
  }
  console.log(
    `  worst raw expectation ${worst.toFixed(4)}, calibration constant ${EVIDENCE_CALIBRATION}, worst calibrated ${(worst / EVIDENCE_CALIBRATION).toFixed(4)}`,
  );
  console.log("");
}

function priorHeadToHead() {
  console.log(
    `== 12. old prior against new prior on the same runs, ${POWER_RUNS} runs, ${POWER_LOOKS} looks, horizon 48000 ==`,
  );
  console.log("  only the prior inside the bayes factor changes, alpha and the ville bar are untouched");
  console.log("  scenario                        allocation    old fires   new fires   new right");
  const step = Math.floor(48000 / POWER_LOOKS);
  const cases: [string, number[], number, Allocation][] = [
    ["null 0.5% vs 0.5%", [0.005, 0.005], -1, "even"],
    ["null 0.5% vs 0.5%", [0.005, 0.005], -1, "thompson"],
    ["null 3.0% vs 3.0%", [0.03, 0.03], -1, "even"],
    ["null 3.0% vs 3.0%", [0.03, 0.03], -1, "thompson"],
    ["null 20% vs 20%", [0.2, 0.2], -1, "even"],
    ["null 20% vs 20%", [0.2, 0.2], -1, "thompson"],
    ["null 50% vs 50%", [0.5, 0.5], -1, "even"],
    ["null 50% vs 50%", [0.5, 0.5], -1, "thompson"],
    ["power 3.0% -> 3.6%", [0.03, 0.036], 1, "even"],
    ["power 3.0% -> 4.0%", [0.03, 0.04], 1, "thompson"],
    ["power 3.0% -> 6.0%", [0.03, 0.06], 1, "thompson"],
    ["power 20% -> 22%", [0.2, 0.22], 1, "thompson"],
    ["power 50% -> 55%", [0.5, 0.55], 1, "thompson"],
  ];
  for (const [label, rates, best, allocation] of cases) {
    let oldFires = 0;
    let newFires = 0;
    let newRight = 0;
    for (let r = 0; r < POWER_RUNS; r++) {
      const seed = 810000 + r * 7919 + Math.round(rates[1] * 100000);
      const trafficRng = createRng(seed);
      const evalRng = createRng(seed ^ 0x85ebca6b);
      let arms = freshArms(2);
      let oldFired = false;
      let newFired = false;
      for (let look = 1; look <= POWER_LOOKS && !(oldFired && newFired); look++) {
        arms = simulateTraffic(arms, rates, step, trafficRng, allocation);
        const res = evaluate(arms, { ...CURRENT, rng: evalRng });
        const ready = res.thresholdMet && res.minImpressionsMet && res.effectSizeOk;
        if (!ready) continue;
        const legacyE =
          res.probabilityBest <= 0
            ? 0
            : Math.exp(Math.log(res.probabilityBest) + logMixtureBayesFactor(arms, 0.5, 0.5));
        if (!oldFired && legacyE >= 20) {
          oldFired = true;
          oldFires++;
        }
        if (!newFired && res.anytimeValid) {
          newFired = true;
          newFires++;
          if (res.candidateIndex === best) newRight++;
        }
      }
    }
    console.log(
      `  ${label.padEnd(30)} ${allocation.padEnd(10)}   ${pct(oldFires / POWER_RUNS).padStart(9)}   ${pct(newFires / POWER_RUNS).padStart(9)}   ${pct(newRight / POWER_RUNS).padStart(9)}`,
    );
  }
  console.log("");
}

function main() {
  const t0 = Date.now();
  console.log(
    `runs=${RUNS} mc=${MC} legacyMc=${LEGACY_MC} horizon=${HORIZON} threshold=${THRESHOLD} minImpressions=${MIN_IMPRESSIONS}`,
  );
  console.log("old rule : Beta(c+1, f+1), candidateRule=sample, gate = P(best) > 0.95 only");
  console.log(
    "new rule : Jeffreys posterior, candidateRule=probabilityBest, gate = P(best) > 0.95 AND expectedLoss < 1% AND eValue >= 20",
  );
  console.log(
    `e-value  : cohort Bayes factor at concentration ${DEFAULT_EVIDENCE_CONCENTRATION}, divided by the calibration constant ${EVIDENCE_CALIBRATION}`,
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

  console.log(
    `== 8. power curve, 2 arms, ${POWER_RUNS} runs, ${POWER_LOOKS} looks, lost clicks measured against an oracle ==`,
  );
  console.log("  8a. even split, the classic a/b holdout: waiting costs on every impression");
  const evenCells = powerCurve("even");
  console.log("");
  console.log("  8b. thompson allocation, what banditd actually serves: waiting is nearly free");
  const thompsonCells = powerCurve("thompson");
  console.log("");

  console.log("== 9. is alpha the binding constraint? same runs, e-value bar moved ==");
  alphaSweep("even split  3.0% -> 3.3% n=48000 ", [0.03, 0.033], 1, 48000, "even", 31000);
  alphaSweep("even split  3.0% -> 4.0% n=48000 ", [0.03, 0.04], 1, 48000, "even", 32000);
  alphaSweep("thompson    3.0% -> 4.0% n=48000 ", [0.03, 0.04], 1, 48000, "thompson", 33000);
  alphaSweep("thompson    3.0% -> 6.0% n=48000 ", [0.03, 0.06], 1, 48000, "thompson", 34000);
  console.log("");

  priorScaleTable();
  calibrationTable();
  priorHeadToHead();

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
  for (const [label, cells] of [
    ["even split", evenCells],
    ["thompson", thompsonCells],
  ] as [string, PowerCell[]][]) {
    console.log(`== summary: power curve and the price of waiting, ${label} ==`);
    console.log(
      "  gap                       n   old fires   new fires   old right   new right   old lost   new lost   hold lost   cheaper",
    );
    for (const c of cells) {
      const delta = c.current.loss - c.legacy.loss;
      const cheaper = Math.abs(delta) < 1 ? "tie" : delta < 0 ? "four gates" : "naive rule";
      console.log(
        `  ${gapLabel(c.base, c.lift).padEnd(21)}${String(c.horizon).padStart(7)}   ${pct(c.legacy.fire).padStart(9)}   ${pct(c.current.fire).padStart(9)}   ${pct(c.legacy.right).padStart(9)}   ${pct(c.current.right).padStart(9)}   ${c.legacy.loss.toFixed(1).padStart(8)}   ${c.current.loss.toFixed(1).padStart(8)}   ${c.holdLoss.toFixed(1).padStart(9)}   ${cheaper}`,
      );
    }
    console.log("");
  }
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
