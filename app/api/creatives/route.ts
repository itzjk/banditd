import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { logAudit } from "@/lib/store";
import type { Creative } from "@/lib/store";
import { generateVariants, startBudget } from "@/lib/openai";
import { guard } from "@/lib/access";
import { readRun, updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { CreativesInput } from "@/lib/contracts";

export const maxDuration = 300;

const TEXT_BUDGET_MS = Number(process.env.CREATIVES_TEXT_BUDGET_MS ?? 70000);

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const client = await guard(req, "model");
    const { runId, parentId } = await readJson(req, CreativesInput);
    const { state } = await readRun(runId, client);

    if (!state.product) throw new HttpFailure("NO_PRODUCT", 400, "no product submitted yet");
    if (!state.research) throw new HttpFailure("NO_RESEARCH", 400, "run research first");

    const parent = parentId ? state.creatives.find((c) => c.id === parentId) : undefined;
    if (parentId && !parent) {
      throw new HttpFailure("PARENT_NOT_FOUND", 404, "parent creative not found on this run");
    }

    const specs = await generateVariants(
      state.product,
      state.research,
      startBudget("Creative writing", TEXT_BUDGET_MS),
      parent ? { headline: parent.headline, body: parent.body, angle: parent.angle } : undefined,
    );

    const generation = parent ? parent.generation + 1 : 0;
    const batch = `${Date.now()}_${randomBytes(3).toString("hex")}`;
    const created: Creative[] = specs.map((spec, i) => ({
      id: `cr_${batch}_${i}`,
      generation,
      parentId: parent?.id ?? null,
      angle: spec.angle,
      headline: spec.headline,
      body: spec.body,
      imagePrompt: spec.imagePrompt,
      targetEmotion: spec.targetEmotion,
      imageData: null,
      arm: { impressions: 0, clicks: 0 },
    }));

    const { record } = await updateRun(runId, client, ({ state: latest }) => {
      latest.creatives.push(...created);
      logAudit(
        latest,
        "creatives",
        parent
          ? `Generated ${created.length} variants from the winner "${parent.headline}", images requested one by one`
          : `Generated ${created.length} variants across ${created.map((c) => c.angle).join(", ")}, images requested one by one`,
      );
    });
    return NextResponse.json(record.state);
  } catch (err) {
    if (!(err instanceof HttpFailure)) {
      console.error(`creatives gave up after ${Math.round((Date.now() - started) / 1000)}s`, err);
    }
    return failure(err);
  }
}
