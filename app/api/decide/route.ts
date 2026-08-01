import { NextResponse } from "next/server";
import { getState, audit } from "@/lib/store";
import { evaluate } from "@/lib/bandit";
import { decideSpend } from "@/lib/openai";
import { getMandate, listMandates } from "@/lib/prava";
import type { DecisionContext } from "@/lib/openai";
import type { Mandate } from "@/lib/prava";

export const maxDuration = 300;

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

export async function POST() {
  const state = getState();

  if (state.creatives.length === 0) {
    return NextResponse.json({ error: "no creatives to evaluate" }, { status: 400 });
  }

  const generation = Math.max(...state.creatives.map((c) => c.generation));
  const cohort = state.creatives.filter((c) => c.generation === generation);

  const evaluation = evaluate(
    cohort.map((c) => c.arm),
    { samples: 20000, candidateRule: "probabilityBest" },
  );

  const mandate = await readMandate(state.mandateId);
  if (state.mandateId && !mandate.live) {
    audit("mandate", "Prava did not answer, deciding without live mandate data");
  }

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
    mandateRemaining: mandate.remaining,
    mandateScope: mandate.scope,
    mandateExpiry: mandate.expiry,
    creditPrice: CREDIT_PRICE,
  };

  const decision = await decideSpend(context);
  const candidate = cohort[evaluation.candidateIndex];

  if (decision.shouldBuy) {
    audit(
      "decision",
      `Agent wants to spend ${decision.amount} on render credits for "${candidate?.headline ?? "unknown variant"}" at ${(evaluation.probabilityBest * 100).toFixed(1)}% probability best. ${decision.reason}`,
    );
  } else {
    audit(
      "decision",
      `Agent held the money back at ${(evaluation.probabilityBest * 100).toFixed(1)}% probability best over ${evaluation.totalImpressions} impressions. ${decision.abstainedBecause}`,
    );
  }

  return NextResponse.json({
    decision,
    evaluation: { ...evaluation, generation, candidateId: candidate?.id ?? null },
    state: getState(),
  });
}
