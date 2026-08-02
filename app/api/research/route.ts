import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { openSession, commit, logAudit } from "@/lib/store";
import { researchMarket, startBudget, failureBody } from "@/lib/openai";

export const maxDuration = 300;

const BUDGET_MS = Number(process.env.RESEARCH_BUDGET_MS ?? 100000);

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { state?: unknown };
  const session = openSession(body.state);

  const product = session.state.product;
  if (!product) {
    return NextResponse.json({ error: "no product submitted yet" }, { status: 400 });
  }

  const budget = startBudget("Market research", BUDGET_MS);
  const started = Date.now();

  try {
    const research = await researchMarket(product, budget);
    session.state.research = research;

    logAudit(
      session.state,
      "research",
      `Searched the live web and read ${research.sources.length} sources on ${product.name}`,
    );

    return NextResponse.json(commit(session));
  } catch (err) {
    const { status, body: payload } = failureBody(err);
    console.error(
      `research gave up after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
      err,
    );
    return NextResponse.json(payload, { status });
  }
}
