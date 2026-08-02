import { evaluate, createRng, DEFAULT_MIN_IMPRESSIONS, DEFAULT_THRESHOLD } from "@/lib/bandit";
import { cohortSeed } from "@/lib/cohort-seed";
import type { ChatAd, ChatGates, ChatPurchase, ChatSnapshot } from "@/lib/openai";
import type { State } from "@/lib/store";

export const CREDIT_PRICE = process.env.RENDER_CREDIT_PRICE ?? "4.00";
export const MANDATE_CAP = process.env.MANDATE_CAP ?? "50.00";

const MAX_PURCHASES = 6;
const E_VALUE_TARGET = 20;

export function clean(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/<{2,}|>{2,}/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, limit);
}

function rate(impressions: number, clicks: number): string {
  if (!impressions) return "0.00%";
  return `${((clicks / impressions) * 100).toFixed(2)}%`;
}

function money(value: string): number {
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function describeMandate(state: State): string {
  if (!state.mandateId) {
    return "no mandate signed on this run, so the agent has nothing to charge. The seller signs one from the dashboard.";
  }
  const revoked = state.audit.some(
    (entry) => entry.kind === "mandate" && /revok/i.test(entry.detail),
  );
  const charges = state.purchases.filter((p) => p.ok).length;
  return `signed, id ${state.mandateId}, cap set to ${MANDATE_CAP} USD for this demo, ${charges} successful ${charges === 1 ? "charge" : "charges"} recorded on this run${revoked ? ", and the audit log shows it was revoked" : ""}. The live balance held at Prava is not in this view, read_mandate_limits fetches it.`;
}

export function cohortOf(state: State) {
  const generation = state.creatives.length
    ? Math.max(...state.creatives.map((c) => c.generation))
    : 0;
  return { generation, cohort: state.creatives.filter((c) => c.generation === generation) };
}

export function buildSnapshot(state: State): ChatSnapshot {
  const { generation, cohort } = cohortOf(state);
  const totalImpressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);

  let gates: ChatGates | null = null;
  let candidateIndex = -1;
  if (cohort.length > 0 && totalImpressions > 0) {
    const evaluation = evaluate(
      cohort.map((c) => c.arm),
      { samples: 20000, candidateRule: "probabilityBest", rng: createRng(cohortSeed(cohort)) },
    );
    candidateIndex = evaluation.candidateIndex;
    const candidate = cohort[candidateIndex];
    gates = {
      candidateHeadline: candidate?.headline ?? "unknown variant",
      candidateImpressions: candidate?.arm.impressions ?? 0,
      probabilityBest: evaluation.probabilityBest,
      expectedLoss: evaluation.expectedLoss,
      posteriorMean: evaluation.posteriorMean,
      eValue: evaluation.eValue,
      totalImpressions: evaluation.totalImpressions,
      thresholdMet: evaluation.thresholdMet,
      minImpressionsMet: evaluation.minImpressionsMet,
      effectSizeOk: evaluation.effectSizeOk,
      anytimeValid: evaluation.anytimeValid,
      sufficientEvidence: evaluation.sufficientEvidence,
    };
  }

  const ads: ChatAd[] = cohort.map((c, index) => ({
    angle: c.angle,
    headline: c.headline,
    impressions: c.arm.impressions,
    clicks: c.arm.clicks,
    ctr: rate(c.arm.impressions, c.arm.clicks),
    candidate: index === candidateIndex,
  }));

  const purchases: ChatPurchase[] = state.purchases.slice(0, MAX_PURCHASES).map((p) => ({
    at: p.at,
    amount: p.amount,
    ok: p.ok,
    errorCode: p.errorCode,
    reason: clean(p.reason, 240),
  }));

  const spent = state.purchases
    .filter((p) => p.ok)
    .reduce((sum, p) => sum + money(p.amount), 0)
    .toFixed(2);

  const lastDecision = state.audit.find((entry) => entry.kind === "decision")?.detail ?? "";

  return {
    product: state.product,
    buyerProfile: state.research?.buyerProfile ?? "",
    pricePositioning: state.research?.pricePositioning ?? "",
    sourceCount: state.research?.sources.length ?? 0,
    generation,
    ads,
    gates,
    lastDecision: clean(lastDecision, 400),
    buyerLesson: clean(state.insights?.buyerLesson ?? "", 400),
    purchases,
    spent,
    credits: state.credits.balance,
    creditPrice: CREDIT_PRICE,
    mandate: describeMandate(state),
  };
}

export interface DecisionReading {
  hasRun: boolean;
  generation: number;
  candidate: { headline: string; angle: string; impressions: number; clicks: number; ctr: string } | null;
  gates: {
    probabilityBest: { value: number; needs: number; passed: boolean };
    candidateImpressions: { value: number; needs: number; passed: boolean };
    expectedLoss: { value: number; needsUnder: number; posteriorMean: number; passed: boolean };
    eValue: { value: number; needs: number; passed: boolean };
    allFourOpen: boolean;
  } | null;
  blockingGate: string | null;
  totalImpressions: number;
  decisionNote: string;
  purchaseNotes: string[];
  note: string;
}

export function explainDecision(state: State): DecisionReading {
  const { generation, cohort } = cohortOf(state);
  const totalImpressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const decisionNote = clean(
    state.audit.find((entry) => entry.kind === "decision")?.detail ?? "",
    600,
  );
  const purchaseNotes = state.audit
    .filter((entry) => entry.kind === "purchase")
    .slice(0, 3)
    .map((entry) => clean(entry.detail, 400));

  if (cohort.length === 0 || totalImpressions === 0) {
    return {
      hasRun: false,
      generation,
      candidate: null,
      gates: null,
      blockingGate: null,
      totalImpressions,
      decisionNote,
      purchaseNotes,
      note: "No traffic has been served on this generation, so there is no gate reading and no decision to explain yet.",
    };
  }

  const evaluation = evaluate(
    cohort.map((c) => c.arm),
    { samples: 20000, candidateRule: "probabilityBest", rng: createRng(cohortSeed(cohort)) },
  );
  const candidate = cohort[evaluation.candidateIndex];
  const lossCeiling = evaluation.posteriorMean * 0.01;

  const blocking = !evaluation.thresholdMet
    ? "probability best is still under 95 percent"
    : !evaluation.minImpressionsMet
      ? "the candidate ad has fewer than 200 impressions of its own"
      : !evaluation.effectSizeOk
        ? "expected loss is still above 1 percent of the candidate posterior click rate"
        : !evaluation.anytimeValid
          ? "the e value is still under 20"
          : null;

  return {
    hasRun: true,
    generation,
    candidate: candidate
      ? {
          headline: candidate.headline,
          angle: candidate.angle,
          impressions: candidate.arm.impressions,
          clicks: candidate.arm.clicks,
          ctr: rate(candidate.arm.impressions, candidate.arm.clicks),
        }
      : null,
    gates: {
      probabilityBest: {
        value: evaluation.probabilityBest,
        needs: DEFAULT_THRESHOLD,
        passed: evaluation.thresholdMet,
      },
      candidateImpressions: {
        value: candidate?.arm.impressions ?? 0,
        needs: DEFAULT_MIN_IMPRESSIONS,
        passed: evaluation.minImpressionsMet,
      },
      expectedLoss: {
        value: evaluation.expectedLoss,
        needsUnder: lossCeiling,
        posteriorMean: evaluation.posteriorMean,
        passed: evaluation.effectSizeOk,
      },
      eValue: { value: evaluation.eValue, needs: E_VALUE_TARGET, passed: evaluation.anytimeValid },
      allFourOpen: evaluation.sufficientEvidence,
    },
    blockingGate: blocking,
    totalImpressions: evaluation.totalImpressions,
    decisionNote,
    purchaseNotes,
    note: "These numbers are recomputed from the click counts of this run, they are not remembered from an earlier answer. Impressions and clicks come from the traffic simulator.",
  };
}
