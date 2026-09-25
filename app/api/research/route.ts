import { NextResponse } from "next/server";
import { logAudit } from "@/lib/store";
import { researchMarket, startBudget } from "@/lib/openai";
import { guard } from "@/lib/access";
import { readRun, updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { RunOnly } from "@/lib/contracts";

export const maxDuration = 300;

const BUDGET_MS = Number(process.env.RESEARCH_BUDGET_MS ?? 100000);

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const client = await guard(req, "model");
    const { runId } = await readJson(req, RunOnly);
    const { state } = await readRun(runId, client);

    const product = state.product;
    if (!product) throw new HttpFailure("NO_PRODUCT", 400, "no product submitted yet");

    const research = await researchMarket(product, startBudget("Market research", BUDGET_MS));

    const { record } = await updateRun(runId, client, ({ state: latest }) => {
      latest.research = research;
      logAudit(
        latest,
        "research",
        `Searched the live web and read ${research.sources.length} sources on ${product.name}`,
      );
    });
    return NextResponse.json(record.state);
  } catch (err) {
    if (!(err instanceof HttpFailure)) {
      console.error(`research gave up after ${Math.round((Date.now() - started) / 1000)}s`, err);
    }
    return failure(err);
  }
}
