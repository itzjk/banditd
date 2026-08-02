import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { openSession } from "@/lib/store";
import { evaluate, createRng } from "@/lib/bandit";
import { cohortSeed } from "@/lib/cohort-seed";
import { answerRunQuestion, startBudget, failureBody } from "@/lib/openai";
import type { ChatAd, ChatGates, ChatPurchase, ChatSnapshot, ChatTurn } from "@/lib/openai";
import type { State } from "@/lib/store";

export const maxDuration = 120;

const BUDGET_MS = Number(process.env.CHAT_BUDGET_MS ?? 60000);
const CREDIT_PRICE = process.env.RENDER_CREDIT_PRICE ?? "4.00";
const MANDATE_CAP = process.env.MANDATE_CAP ?? "50.00";
const MAX_TURNS = 10;
const MAX_QUESTION = 700;
const MAX_ANSWER = 1200;
const MAX_PURCHASES = 6;

function clean(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/<{2,}|>{2,}/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, limit);
}

function readTurns(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ChatTurn[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { role?: unknown; content?: unknown };
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
    if (!role) continue;
    const content = clean(item.content, role === "user" ? MAX_QUESTION : MAX_ANSWER);
    if (!content) continue;
    turns.push({ role, content });
  }
  return turns.slice(-MAX_TURNS);
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
  return `signed, id ${state.mandateId}, cap set to ${MANDATE_CAP} USD for this demo, ${charges} successful ${charges === 1 ? "charge" : "charges"} recorded on this run${revoked ? ", and the audit log shows it was revoked" : ""}. The live balance held at Prava is not in this view.`;
}

function buildSnapshot(state: State): ChatSnapshot {
  const generation = state.creatives.length
    ? Math.max(...state.creatives.map((c) => c.generation))
    : 0;
  const cohort = state.creatives.filter((c) => c.generation === generation);
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

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; state?: unknown };
  const turns = readTurns(body.messages);

  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "Send a question and the agent will answer it from this run." },
      { status: 400 },
    );
  }

  const session = openSession(body.state);
  const snapshot = buildSnapshot(session.state);

  const budget = startBudget("The answer", BUDGET_MS);
  const started = Date.now();

  try {
    const answer = await answerRunQuestion(turns, snapshot, budget);
    return NextResponse.json({ answer });
  } catch (err) {
    const { status, body: payload } = failureBody(err);
    console.error(
      `chat gave up after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
      err,
    );
    return NextResponse.json(payload, { status });
  }
}
