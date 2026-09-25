import { NextResponse } from "next/server";
import { logAudit, liveCohort } from "@/lib/store";
import { recommendPlays, startBudget } from "@/lib/openai";
import type { InsightContext } from "@/lib/openai";
import { guard } from "@/lib/access";
import { readRun, updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { RunOnly } from "@/lib/contracts";

export const maxDuration = 300;

const BUDGET_MS = Number(process.env.INSIGHTS_BUDGET_MS ?? 90000);

function rate(impressions: number, clicks: number): string {
  if (!impressions) return "0.00%";
  return `${((clicks / impressions) * 100).toFixed(2)}%`;
}

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const client = await guard(req, "model");
    const { runId } = await readJson(req, RunOnly);
    const { state } = await readRun(runId, client);

    const product = state.product;
    if (!product) {
      throw new HttpFailure(
        "NO_PRODUCT",
        400,
        "No product to advise on yet. Submit one on the home page first.",
      );
    }
    const research = state.research;
    if (!research) {
      throw new HttpFailure(
        "NO_RESEARCH",
        400,
        "No market research on file. Run step 1 first, the recommendations are built on what that web search found.",
      );
    }
    const cohort = liveCohort(state);
    if (cohort.length === 0) {
      throw new HttpFailure(
        "NO_CREATIVES",
        400,
        "No creatives to read. Generate the four ads first, then serve them traffic.",
      );
    }
    const generation = cohort[0].generation;
    const totalImpressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
    if (totalImpressions === 0) {
      throw new HttpFailure(
        "NO_TRAFFIC",
        400,
        "No traffic measured yet. Serve impressions on step 3 and the agent will have click rates to reason from.",
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

    const draft = await recommendPlays(context, startBudget("The recommendations", BUDGET_MS));

    const { record } = await updateRun(runId, client, ({ state: latest }) => {
      latest.insights = {
        at: new Date().toISOString(),
        generation,
        impressions: totalImpressions,
        winnerAngle: best.angle,
        winnerHeadline: best.headline,
        ...draft,
      };
      logAudit(
        latest,
        "insights",
        `Read the ${best.angle} angle winning at ${rate(best.arm.impressions, best.arm.clicks)} over ${totalImpressions.toLocaleString("en-US")} simulated impressions and wrote ${draft.competitorPlays.length} untested competitor ${draft.competitorPlays.length === 1 ? "play" : "plays"}, ${draft.nextTests.length} ${draft.nextTests.length === 1 ? "test" : "tests"} for the next round and ${draft.estimates.length} ${draft.estimates.length === 1 ? "estimate" : "estimates"}`,
      );
    });
    return NextResponse.json(record.state);
  } catch (err) {
    if (!(err instanceof HttpFailure)) {
      console.error(`insights gave up after ${Math.round((Date.now() - started) / 1000)}s`, err);
    }
    return failure(err);
  }
}
