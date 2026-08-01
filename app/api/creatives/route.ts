import { NextResponse } from "next/server";
import { openSession, commit, logAudit } from "@/lib/store";
import { generateVariants, generateImage, startBudget, failureBody } from "@/lib/openai";
import type { Creative } from "@/lib/store";

export const maxDuration = 300;

const TEXT_BUDGET_MS = Number(process.env.CREATIVES_TEXT_BUDGET_MS ?? 70000);
const IMAGE_BUDGET_MS = Number(process.env.CREATIVES_IMAGE_BUDGET_MS ?? 90000);

export async function POST(req: Request) {
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

  const imageBudget = startBudget("Image render", IMAGE_BUDGET_MS);
  const images = await Promise.all(
    specs.map((spec) => generateImage(spec.imagePrompt, imageBudget)),
  );
  const rendered = images.filter(Boolean).length;

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
    imageData: images[i],
    arm: { impressions: 0, clicks: 0 },
  }));

  state.creatives.push(...created);

  const imageNote =
    rendered === created.length
      ? ""
      : `, ${created.length - rendered} image(s) ran out of render time and were left blank`;

  logAudit(
    state,
    "creatives",
    parent
      ? `Generated ${created.length} variants from the winner "${parent.headline}"${imageNote}`
      : `Generated ${created.length} variants across ${created.map((c) => c.angle).join(", ")}${imageNote}`,
  );

  return NextResponse.json(commit(session));
}
