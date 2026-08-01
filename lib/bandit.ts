export interface Arm {
  id?: string;
  impressions: number;
  clicks: number;
}

export type Rng = () => number;

export type CandidateRule = "sample" | "probabilityBest" | "posteriorMean";

export type Allocation = "thompson" | "even";

export interface EvaluateOptions {
  samples?: number;
  threshold?: number;
  minImpressions?: number;
  candidateRule?: CandidateRule;
  rng?: Rng;
  priorAlpha?: number;
  priorBeta?: number;
  effectSizeTolerance?: number;
  alpha?: number;
}

export interface Evaluation {
  candidateIndex: number;
  probabilityBest: number;
  sufficientEvidence: boolean;
  totalImpressions: number;
  expectedLoss: number;
  eValue: number;
  posteriorMean: number;
  thresholdMet: boolean;
  minImpressionsMet: boolean;
  effectSizeOk: boolean;
  anytimeValid: boolean;
}

const defaultRng: Rng = Math.random;

export const DEFAULT_PRIOR_ALPHA = 0.5;
export const DEFAULT_PRIOR_BETA = 0.5;
export const DEFAULT_SAMPLES = 20000;
export const DEFAULT_EFFECT_SIZE_TOLERANCE = 0.01;
export const DEFAULT_ALPHA = 0.05;

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleNormal(rng: Rng): number {
  let u = rng();
  while (u <= 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function sampleGamma(shape: number, rng: Rng = defaultRng): number {
  if (!(shape > 0)) throw new Error(`shape must be positive, got ${shape}`);
  if (shape < 1) {
    let u = rng();
    while (u <= 0) u = rng();
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = sampleNormal(rng);
    const t = 1 + c * x;
    if (t <= 0) continue;
    const v = t * t * t;
    const u = rng();
    const xx = x * x;
    if (u < 1 - 0.0331 * xx * xx) return d * v;
    if (Math.log(u) < 0.5 * xx + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha: number, beta: number, rng: Rng = defaultRng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const s = x + y;
  if (!(s > 0) || !Number.isFinite(s)) return rng() < alpha / (alpha + beta) ? 1 : 0;
  return x / s;
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function logBetaFn(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

export function logMixtureBayesFactor(arms: Arm[], priorAlpha: number, priorBeta: number): number {
  if (arms.length < 2) return 0;
  const base = logBetaFn(priorAlpha, priorBeta);
  let clicks = 0;
  let misses = 0;
  for (const arm of arms) {
    clicks += arm.clicks;
    misses += arm.impressions - arm.clicks;
  }
  const pooled = logBetaFn(priorAlpha + clicks, priorBeta + misses) - base;
  const terms = arms.map((arm) => {
    const miss = arm.impressions - arm.clicks;
    const split =
      logBetaFn(priorAlpha + arm.clicks, priorBeta + miss) -
      base +
      logBetaFn(priorAlpha + clicks - arm.clicks, priorBeta + misses - miss) -
      base;
    return split - pooled;
  });
  const top = Math.max(...terms);
  if (!Number.isFinite(top)) return top;
  let acc = 0;
  for (const t of terms) acc += Math.exp(t - top);
  return top + Math.log(acc / arms.length);
}

export function evaluate(arms: Arm[], options: EvaluateOptions = {}): Evaluation {
  const rng = options.rng ?? defaultRng;
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const threshold = options.threshold ?? 0.95;
  const minImpressions = options.minImpressions ?? 200;
  const rule = options.candidateRule ?? "probabilityBest";
  const priorAlpha = options.priorAlpha ?? DEFAULT_PRIOR_ALPHA;
  const priorBeta = options.priorBeta ?? DEFAULT_PRIOR_BETA;
  const tolerance = options.effectSizeTolerance ?? DEFAULT_EFFECT_SIZE_TOLERANCE;
  const alphaLevel = options.alpha ?? DEFAULT_ALPHA;
  const totalImpressions = arms.reduce((sum, a) => sum + a.impressions, 0);

  if (arms.length === 0) {
    return {
      candidateIndex: -1,
      probabilityBest: 0,
      sufficientEvidence: false,
      totalImpressions,
      expectedLoss: Number.POSITIVE_INFINITY,
      eValue: 0,
      posteriorMean: 0,
      thresholdMet: false,
      minImpressionsMet: false,
      effectSizeOk: false,
      anytimeValid: false,
    };
  }
  if (arms.length === 1) {
    const enough = arms[0].impressions >= minImpressions;
    return {
      candidateIndex: 0,
      probabilityBest: 1,
      sufficientEvidence: enough,
      totalImpressions,
      expectedLoss: 0,
      eValue: Number.POSITIVE_INFINITY,
      posteriorMean:
        (arms[0].clicks + priorAlpha) / (arms[0].impressions + priorAlpha + priorBeta),
      thresholdMet: true,
      minImpressionsMet: enough,
      effectSizeOk: true,
      anytimeValid: true,
    };
  }

  const alpha = arms.map((a) => a.clicks + priorAlpha);
  const beta = arms.map((a) => a.impressions - a.clicks + priorBeta);

  let sampled = 0;
  let bestDraw = -1;
  for (let k = 0; k < arms.length; k++) {
    const draw = sampleBeta(alpha[k], beta[k], rng);
    if (draw > bestDraw) {
      bestDraw = draw;
      sampled = k;
    }
  }

  const wins = new Array<number>(arms.length).fill(0);
  const lossSum = new Array<number>(arms.length).fill(0);
  const draws = new Array<number>(arms.length).fill(0);
  for (let s = 0; s < samples; s++) {
    let leader = 0;
    for (let k = 0; k < arms.length; k++) {
      draws[k] = sampleBeta(alpha[k], beta[k], rng);
      if (draws[k] > draws[leader]) leader = k;
    }
    wins[leader]++;
    const top = draws[leader];
    for (let k = 0; k < arms.length; k++) lossSum[k] += top - draws[k];
  }

  let candidateIndex = sampled;
  if (rule === "probabilityBest") {
    candidateIndex = 0;
    for (let k = 1; k < arms.length; k++) if (wins[k] > wins[candidateIndex]) candidateIndex = k;
  } else if (rule === "posteriorMean") {
    candidateIndex = 0;
    let bestMean = alpha[0] / (alpha[0] + beta[0]);
    for (let k = 1; k < arms.length; k++) {
      const mean = alpha[k] / (alpha[k] + beta[k]);
      if (mean > bestMean) {
        bestMean = mean;
        candidateIndex = k;
      }
    }
  }

  const probabilityBest = wins[candidateIndex] / samples;
  const expectedLoss = lossSum[candidateIndex] / samples;
  const posteriorMean =
    alpha[candidateIndex] / (alpha[candidateIndex] + beta[candidateIndex]);

  const logBf = logMixtureBayesFactor(arms, priorAlpha, priorBeta);
  const eValue = probabilityBest <= 0 ? 0 : Math.exp(Math.log(probabilityBest) + logBf);

  const thresholdMet = probabilityBest > threshold;
  const minImpressionsMet = arms[candidateIndex].impressions >= minImpressions;
  const effectSizeOk = expectedLoss < tolerance * posteriorMean;
  const anytimeValid = eValue >= 1 / alphaLevel;

  return {
    candidateIndex,
    probabilityBest,
    sufficientEvidence:
      thresholdMet && minImpressionsMet && effectSizeOk && anytimeValid,
    totalImpressions,
    expectedLoss,
    eValue,
    posteriorMean,
    thresholdMet,
    minImpressionsMet,
    effectSizeOk,
    anytimeValid,
  };
}

export function simulateTraffic(
  arms: Arm[],
  trueRates: number[],
  impressions: number,
  rng: Rng = defaultRng,
  allocation: Allocation = "thompson",
): Arm[] {
  if (arms.length !== trueRates.length) throw new Error("arms and trueRates length mismatch");
  const next = arms.map((a) => ({ ...a }));
  let served = next.reduce((sum, a) => sum + a.impressions, 0);
  for (let i = 0; i < impressions; i++) {
    let target = served % next.length;
    if (allocation === "thompson") {
      let bestDraw = -1;
      for (let k = 0; k < next.length; k++) {
        const draw = sampleBeta(
          next[k].clicks + 1,
          next[k].impressions - next[k].clicks + 1,
          rng,
        );
        if (draw > bestDraw) {
          bestDraw = draw;
          target = k;
        }
      }
    }
    next[target].impressions += 1;
    if (rng() < trueRates[target]) next[target].clicks += 1;
    served += 1;
  }
  return next;
}
