import { NextResponse } from "next/server";
import { logAudit } from "@/lib/store";
import { refineProduct, startBudget } from "@/lib/openai";
import { guard } from "@/lib/access";
import { readRun, updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { RunOnly } from "@/lib/contracts";

export const maxDuration = 300;

const BUDGET_MS = Number(process.env.REFINE_BUDGET_MS ?? 60000);

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const client = await guard(req, "model");
    const { runId } = await readJson(req, RunOnly);
    const { state } = await readRun(runId, client);

    const product = state.product;
    if (!product) throw new HttpFailure("NO_PRODUCT", 400, "no product submitted yet");

    const options = await refineProduct(product, startBudget("The product options", BUDGET_MS));

    const { record } = await updateRun(runId, client, ({ state: latest }) => {
      latest.productOptions = options;
      logAudit(
        latest,
        "refine",
        `Listed ${options.variants.length} variants and ${options.brands.length} brands for "${product.name}" so the seller can aim the run before it starts`,
      );
    });
    return NextResponse.json(record.state);
  } catch (err) {
    if (!(err instanceof HttpFailure)) {
      console.error(`refine gave up after ${Math.round((Date.now() - started) / 1000)}s`, err);
    }
    return failure(err);
  }
}
