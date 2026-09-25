import { NextResponse } from "next/server";
import { readMandateFacts, RENDER_MERCHANT } from "@/lib/authorization";
import type { State } from "@/lib/store";
import { guard } from "@/lib/access";
import { readRun } from "@/lib/run-store";
import { failure, readJson } from "@/lib/http";
import { ChatToolInput } from "@/lib/contracts";
import { buildSnapshot, explainDecision, CREDIT_PRICE, MANDATE_CAP } from "../snapshot";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const client = await guard(req, "read");
    const { runId, tool } = await readJson(req, ChatToolInput);
    const { state } = await readRun(runId, client);
    return await answer(tool, state);
  } catch (err) {
    return failure(err);
  }
}

async function answer(
  tool: "read_run" | "read_mandate_limits" | "explain_last_decision",
  state: State,
) {

  if (tool === "read_run") {
    return NextResponse.json({
      ok: true,
      ...buildSnapshot(state),
      simulatedNote:
        "Impressions, clicks and click rates come from the traffic simulator, not from a live ad platform.",
    });
  }

  if (tool === "explain_last_decision") {
    return NextResponse.json({ ok: true, ...explainDecision(state) });
  }

  const facts = await readMandateFacts(state.mandateId);

  if (!facts.live) {
    return NextResponse.json({
      ok: false,
      live: false,
      error: facts.error ?? "Prava did not answer, so the live limits could not be read.",
      note: "Nothing was changed. The limits below are unknown until Prava answers again.",
    });
  }

  if (!facts.mandate) {
    return NextResponse.json({
      ok: true,
      live: true,
      mandate: null,
      queuedMandates: facts.queued,
      note: "Prava answered and there is no usable mandate on file for this merchant, so the agent has nothing to charge. Only the seller can sign one.",
    });
  }

  const m = facts.mandate;
  return NextResponse.json({
    ok: true,
    live: true,
    mandate: {
      id: m.id,
      merchant: m.merchant,
      merchantScope: m.scope,
      approvedCeiling: m.ceiling,
      remaining: m.remaining,
      expiry: m.expiry,
      frequency: m.frequency,
      maxCharges: m.maxCharges,
      status: m.status,
      chargeUsedThisCycle: m.chargeUsedThisCycle,
    },
    queuedMandates: facts.queued,
    renderCreditsMerchant: RENDER_MERCHANT,
    packPrice: CREDIT_PRICE,
    demoCap: MANDATE_CAP,
    note: "These limits are read only. The agent cannot raise a ceiling, widen the scope, extend an expiry or revoke a mandate. Only the seller can, and the server enforces every limit again on each charge.",
  });
}
