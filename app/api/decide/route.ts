import { NextResponse } from "next/server";
import { logAudit, liveCohort } from "@/lib/store";
import { evaluate, createRng } from "@/lib/bandit";
import { cohortSeed } from "@/lib/cohort-seed";
import { decideSpend, startBudget } from "@/lib/openai";
import { getMandate, listMandates, isMandateId } from "@/lib/prava";
import { guard } from "@/lib/access";
import { readRun, updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { RunOnly } from "@/lib/contracts";
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
  if (!isMandateId(id)) return { remaining: NO_MANDATE, scope: NO_MANDATE, expiry: NO_MANDATE, live: false };

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
  const started = Date.now();
  try {
    const client = await guard(req, "model");
    const { runId } = await readJson(req, RunOnly);
    const { state } = await readRun(runId, client);

    const cohort = liveCohort(state);
    if (cohort.length === 0) throw new HttpFailure("NO_CREATIVES", 400, "no creatives to evaluate");
    const generation = cohort[0].generation;

    const evaluation = evaluate(
      cohort.map((c) => c.arm),
      {
        samples: 20000,
        candidateRule: "probabilityBest",
        rng: createRng(cohortSeed(cohort)),
      },
    );

    const [mandate, queue] = await Promise.all([
      readMandate(state.mandateId),
      mandateQueue(Number(CREDIT_PRICE), state.mandateId, process.env.PRAVA_USER_ID),
    ]);

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

    const decision = await decideSpend(context, startBudget("The spend decision", BUDGET_MS));
    const candidate = cohort[evaluation.candidateIndex];

    const { record } = await updateRun(runId, client, ({ state: latest }) => {
      if (latest.mandateId && !mandate.live) {
        logAudit(latest, "mandate", "Prava did not answer, deciding without live mandate data");
      }
      if (decision.shouldBuy) {
        logAudit(
          latest,
          "decision",
          `Agent wants to spend ${decision.amount} on render credits for "${candidate?.headline ?? "unknown variant"}" at ${(evaluation.probabilityBest * 100).toFixed(1)}% probability best. ${decision.reason}`,
        );
      } else if (decision.trafficPlan) {
        logAudit(
          latest,
          "decision",
          `Agent asked for ${decision.trafficPlan.targetImpressions.toLocaleString("en-US")} impressions before re-reading the evidence: ${decision.trafficPlan.reason}`,
        );
      } else {
        logAudit(
          latest,
          "decision",
          `Agent held the money back at ${(evaluation.probabilityBest * 100).toFixed(1)}% probability best over ${evaluation.totalImpressions} impressions. ${decision.abstainedBecause}`,
        );
      }
    });

    return NextResponse.json({
      decision,
      evaluation: { ...evaluation, generation, candidateId: candidate?.id ?? null },
      state: record.state,
    });
  } catch (err) {
    if (!(err instanceof HttpFailure)) {
      console.error(`decide gave up after ${Math.round((Date.now() - started) / 1000)}s`, err);
    }
    return failure(err);
  }
}
