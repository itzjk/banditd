import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { openSession } from "@/lib/store";
import { readMandateFacts, RENDER_MERCHANT } from "@/lib/authorization";
import { buildSnapshot, explainDecision, CREDIT_PRICE, MANDATE_CAP } from "../snapshot";

export const maxDuration = 30;

type ReadTool = "read_run" | "read_mandate_limits" | "explain_last_decision";

const TOOLS = new Set<ReadTool>(["read_run", "read_mandate_limits", "explain_last_decision"]);

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { tool?: unknown; state?: unknown };
  const tool = typeof body.tool === "string" ? body.tool : "";

  if (!TOOLS.has(tool as ReadTool)) {
    return NextResponse.json(
      { error: `This chat has no read tool called ${tool || "nothing"}.` },
      { status: 400 },
    );
  }

  const session = openSession(body.state);
  const state = session.state;

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
