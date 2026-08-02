import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { openSession, commit, logAudit } from "@/lib/store";
import { generateVariants, startBudget, failureBody } from "@/lib/openai";
import type { Creative } from "@/lib/store";

export const maxDuration = 300;

const TEXT_BUDGET_MS = Number(process.env.CREATIVES_TEXT_BUDGET_MS ?? 70000);

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { parentId?: string; state?: unknown };
  const session = openSession(body.state);
  const state = session.state;

  if (!state.product) {
    return NextResponse.json({ error: "no product submitted yet" }, { status: 400 });
  }
  if (!state.research) {
    return NextResponse.json({ error: "run research first" }, { status: 400 });
  }

  const parentId = body.parentId;
  const parent = parentId ? state.creatives.find((c) => c.id === parentId) : undefined;
  if (parentId && !parent) {
    return NextResponse.json({ error: "parent creative not found" }, { status: 404 });
  }

  const textBudget = startBudget("Creative writing", TEXT_BUDGET_MS);
  const started = Date.now();

  let specs;
  try {
    specs = await generateVariants(
      state.product,
      state.research,
      textBudget,
      parent ? { headline: parent.headline, body: parent.body, angle: parent.angle } : undefined,
    );
  } catch (err) {
    const { status, body: payload } = failureBody(err);
    console.error(
      `creatives gave up after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
      err,
    );
    return NextResponse.json(payload, { status });
  }

  const generation = parent ? parent.generation + 1 : 0;
  const stamp = Date.now();

  const created: Creative[] = specs.map((spec, i) => ({
    id: `cr_${stamp}_${i}`,
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

  state.creatives.push(...created);

  logAudit(
    state,
    "creatives",
    parent
      ? `Generated ${created.length} variants from the winner "${parent.headline}", images requested one by one`
      : `Generated ${created.length} variants across ${created.map((c) => c.angle).join(", ")}, images requested one by one`,
  );

  return NextResponse.json(commit(session));
}
