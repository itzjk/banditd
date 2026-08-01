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
}

export interface Evaluation {
  candidateIndex: number;
  probabilityBest: number;
  sufficientEvidence: boolean;
  totalImpressions: number;
}

const defaultRng: Rng = Math.random;

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

export function evaluate(arms: Arm[], options: EvaluateOptions = {}): Evaluation {
  const rng = options.rng ?? defaultRng;
  const samples = options.samples ?? 20000;
  const threshold = options.threshold ?? 0.95;
  const minImpressions = options.minImpressions ?? 200;
  const rule = options.candidateRule ?? "sample";
  const totalImpressions = arms.reduce((sum, a) => sum + a.impressions, 0);

  if (arms.length === 0) {
    return { candidateIndex: -1, probabilityBest: 0, sufficientEvidence: false, totalImpressions };
  }
  if (arms.length === 1) {
    return {
      candidateIndex: 0,
      probabilityBest: 1,
      sufficientEvidence: arms[0].impressions >= minImpressions,
      totalImpressions,
    };
  }

  const alpha = arms.map((a) => a.clicks + 1);
  const beta = arms.map((a) => a.impressions - a.clicks + 1);

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
  const draws = new Array<number>(arms.length).fill(0);
  for (let s = 0; s < samples; s++) {
    let leader = 0;
    for (let k = 0; k < arms.length; k++) {
      draws[k] = sampleBeta(alpha[k], beta[k], rng);
      if (draws[k] > draws[leader]) leader = k;
    }
    wins[leader]++;
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

  return {
    candidateIndex,
    probabilityBest,
    sufficientEvidence:
      probabilityBest > threshold && arms[candidateIndex].impressions >= minImpressions,
    totalImpressions,
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
