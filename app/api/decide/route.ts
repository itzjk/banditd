import { NextResponse } from "next/server";
import { openSession, commit, logAudit } from "@/lib/store";
import { evaluate, createRng } from "@/lib/bandit";
import { cohortSeed } from "@/lib/cohort-seed";
import { decideSpend, startBudget, failureBody } from "@/lib/openai";
import { getMandate, listMandates } from "@/lib/prava";
import { mandateQueue } from "@/lib/mandate";
import type { DecisionContext } from "@/lib/openai";
import type { Mandate } from "@/lib/prava";

export const maxDuration = 300;

const BUDGET_MS = Number(process.env.DECIDE_BUDGET_MS ?? 80000);
const CREDIT_PRICE = process.env.RENDER_CREDIT_PRICE ?? "4.00";
const NO_MANDATE = "no mandate yet";
const UNREACHABLE = "unknown (Prava unavailable)";

type MandateDetail = Mandate & {
  spent?: string;
  chargeCount?: number;
  charges?: unknown[];
};

interface MandateFacts {
  remaining: string;
  scope: string;
  expiry: string;
  live: boolean;
}

function money(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function describeBudget(detail: MandateDetail | null, listed: Mandate | null): string {
  const approved = money(detail?.approvedAmount ?? listed?.approvedAmount);
  const spent = money(detail?.spent);
  const listedRemaining = money(listed?.remaining);
  const remaining =
    listedRemaining ?? (approved !== null && spent !== null ? approved - spent : null);

  const parts: string[] = [];
  parts.push(remaining !== null ? `${remaining.toFixed(2)} USD remaining` : "remaining unknown");
  if (approved !== null) parts.push(`of ${approved.toFixed(2)} USD approved`);
  if (spent !== null) parts.push(`${spent.toFixed(2)} USD already spent`);

  const charges = detail?.chargeCount ?? detail?.charges?.length;
  if (typeof charges === "number") parts.push(`${charges} charges so far`);

  return parts.join(", ");
}

async function readMandate(id: string | null): Promise<MandateFacts> {
  if (!id) return { remaining: NO_MANDATE, scope: NO_MANDATE, expiry: NO_MANDATE, live: false };

  const [detailResult, listResult] = await Promise.allSettled([
    getMandate(id),
    listMandates(process.env.PRAVA_USER_ID),
  ]);

  const detail = detailResult.status === "fulfilled" ? (detailResult.value as MandateDetail) : null;
  const listed =
    listResult.status === "fulfilled"
      ? (listResult.value.find((m) => m.id === id) ?? null)
      : null;

  if (!detail && !listed) {
    return { remaining: UNREACHABLE, scope: UNREACHABLE, expiry: UNREACHABLE, live: false };
  }

  const status = detail?.status ?? listed?.status;
  const scope = listed?.merchantScope ?? detail?.merchantScope;
  const validUntil = listed?.validUntil ?? detail?.validUntil;
  const renewsAt = listed?.renewsAt ?? detail?.renewsAt;

  return {
    remaining: describeBudget(detail, listed),
    scope: [scope ?? "unknown scope", status ? `mandate status ${status}` : null]
      .filter(Boolean)
      .join(", "),
    expiry: [validUntil ?? "no expiry reported", renewsAt ? `renews ${renewsAt}` : null]
      .filter(Boolean)
      .join(", "),
    live: true,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { state?: unknown };
  const session = openSession(body.state);
  const state = session.state;

  if (state.creatives.length === 0) {
    return NextResponse.json({ error: "no creatives to evaluate" }, { status: 400 });
  }

  const generation = Math.max(...state.creatives.map((c) => c.generation));
  const cohort = state.creatives.filter((c) => c.generation === generation);

  const evaluation = evaluate(
    cohort.map((c) => c.arm),
    {
      samples: 20000,
      candidateRule: "probabilityBest",
      rng: createRng(cohortSeed(cohort)),
    },
  );

  const mandate = await readMandate(state.mandateId);
  if (state.mandateId && !mandate.live) {
    logAudit(state, "mandate", "Prava did not answer, deciding without live mandate data");
  }

  const queue = await mandateQueue(Number(CREDIT_PRICE), state.mandateId, process.env.PRAVA_USER_ID);
  const poolRemaining = queue.candidates.reduce((sum, m) => sum + m.remaining, 0);
  const pool = queue.listError
    ? "signed mandate pool unknown, Prava did not answer"
    : queue.candidates.length
      ? `${queue.candidates.length} signed mandate(s) still chargeable in this cycle, ${poolRemaining.toFixed(2)} USD total, one charge per mandate per monthly cycle`
      : "every signed mandate has already been charged in this cycle, the next purchase will be refused until the seller signs another mandate";

  const context: DecisionContext = {
    arms: cohort.map((c) => ({
      headline: c.headline,
      angle: c.angle,
      impressions: c.arm.impressions,
      clicks: c.arm.clicks,
      ctr: c.arm.impressions
        ? `${((c.arm.clicks / c.arm.impressions) * 100).toFixed(2)}%`
        : "0.00%",
    })),
    candidateIndex: evaluation.candidateIndex,
    probabilityBest: evaluation.probabilityBest,
    sufficientEvidence: evaluation.sufficientEvidence,
    totalImpressions: evaluation.totalImpressions,
    mandateRemaining: `${mandate.remaining}. ${pool}`,
    mandateScope: mandate.scope,
    mandateExpiry: mandate.expiry,
    creditPrice: CREDIT_PRICE,
  };

  const budget = startBudget("The spend decision", BUDGET_MS);
  const started = Date.now();

  let decision;
  try {
    decision = await decideSpend(context, budget);
  } catch (err) {
    const { status, body: payload } = failureBody(err);
    console.error(
      `decide gave up after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
      err,
    );
    return NextResponse.json(payload, { status });
  }

  const candidate = cohort[evaluation.candidateIndex];

  if (decision.shouldBuy) {
    logAudit(
      state,
      "decision",
      `Agent wants to spend ${decision.amount} on render credits for "${candidate?.headline ?? "unknown variant"}" at ${(evaluation.probabilityBest * 100).toFixed(1)}% probability best. ${decision.reason}`,
    );
  } else if (decision.trafficPlan) {
    logAudit(
      state,
      "decision",
      `Agent asked for ${decision.trafficPlan.targetImpressions.toLocaleString("en-US")} impressions before re-reading the evidence: ${decision.trafficPlan.reason}`,
    );
  } else {
    logAudit(
      state,
      "decision",
      `Agent held the money back at ${(evaluation.probabilityBest * 100).toFixed(1)}% probability best over ${evaluation.totalImpressions} impressions. ${decision.abstainedBecause}`,
    );
  }

  return NextResponse.json({
    decision,
    evaluation: { ...evaluation, generation, candidateId: candidate?.id ?? null },
    state: commit(session),
  });
}
