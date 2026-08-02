import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { openSession, commit, logAudit } from "@/lib/store";
import { recommendPlays, startBudget, failureBody } from "@/lib/openai";
import type { InsightContext } from "@/lib/openai";

export const maxDuration = 300;

const BUDGET_MS = Number(process.env.INSIGHTS_BUDGET_MS ?? 90000);

function rate(impressions: number, clicks: number): string {
  if (!impressions) return "0.00%";
  return `${((clicks / impressions) * 100).toFixed(2)}%`;
}

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { state?: unknown };
  const session = openSession(body.state);
  const state = session.state;

  const product = state.product;
  if (!product) {
    return NextResponse.json(
      { error: "No product to advise on yet. Submit one on the home page first." },
      { status: 400 },
    );
  }

  const research = state.research;
  if (!research) {
    return NextResponse.json(
      {
        error:
          "No market research on file. Run step 1 first, the recommendations are built on what that web search found.",
      },
      { status: 400 },
    );
  }

  if (state.creatives.length === 0) {
    return NextResponse.json(
      { error: "No creatives to read. Generate the four ads first, then serve them traffic." },
      { status: 400 },
    );
  }

  const generation = Math.max(...state.creatives.map((c) => c.generation));
  const cohort = state.creatives.filter((c) => c.generation === generation);
  const totalImpressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);

  if (totalImpressions === 0) {
    return NextResponse.json(
      {
        error:
          "No traffic measured yet. Serve impressions on step 3 and the agent will have click rates to reason from.",
      },
      { status: 400 },
    );
  }

  const best = cohort.reduce((top, c) =>
    (c.arm.impressions ? c.arm.clicks / c.arm.impressions : 0) >
    (top.arm.impressions ? top.arm.clicks / top.arm.impressions : 0)
      ? c
      : top,
  );

  const context: InsightContext = {
    product,
    research,
    arms: cohort.map((c) => ({
      headline: c.headline,
      body: c.body,
      angle: c.angle,
      impressions: c.arm.impressions,
      clicks: c.arm.clicks,
      ctr: rate(c.arm.impressions, c.arm.clicks),
      winner: c.id === best.id,
    })),
    generation,
    totalImpressions,
    testedAngles: [...new Set(state.creatives.map((c) => c.angle))],
  };

  const budget = startBudget("The recommendations", BUDGET_MS);
  const started = Date.now();

  try {
    const draft = await recommendPlays(context, budget);

    state.insights = {
      at: new Date().toISOString(),
      generation,
      impressions: totalImpressions,
      winnerAngle: best.angle,
      winnerHeadline: best.headline,
      ...draft,
    };

    logAudit(
      state,
      "insights",
      `Read the ${best.angle} angle winning at ${rate(best.arm.impressions, best.arm.clicks)} over ${totalImpressions.toLocaleString("en-US")} simulated impressions and wrote ${draft.competitorPlays.length} untested competitor ${draft.competitorPlays.length === 1 ? "play" : "plays"}, ${draft.nextTests.length} ${draft.nextTests.length === 1 ? "test" : "tests"} for the next round and ${draft.estimates.length} ${draft.estimates.length === 1 ? "estimate" : "estimates"}`,
    );

    return NextResponse.json(commit(session));
  } catch (err) {
    const { status, body: payload } = failureBody(err);
    console.error(
      `insights gave up after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
      err,
    );
    return NextResponse.json(payload, { status });
  }
}
