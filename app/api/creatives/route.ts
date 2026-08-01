import { NextResponse } from "next/server";
import { getState, update, audit } from "@/lib/store";
import { generateVariants, generateImage } from "@/lib/openai";
import type { Creative } from "@/lib/store";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { parentId } = (await req.json().catch(() => ({}))) as { parentId?: string };

  const state = getState();
  if (!state.product) {
    return NextResponse.json({ error: "no product submitted yet" }, { status: 400 });
  }
  if (!state.research) {
    return NextResponse.json({ error: "run research first" }, { status: 400 });
  }

  const parent = parentId ? state.creatives.find((c) => c.id === parentId) : undefined;
  if (parentId && !parent) {
    return NextResponse.json({ error: "parent creative not found" }, { status: 404 });
  }

  const specs = await generateVariants(
    state.product,
    state.research,
    parent ? { headline: parent.headline, body: parent.body, angle: parent.angle } : undefined,
  );

  const images = await Promise.all(specs.map((spec) => generateImage(spec.imagePrompt)));

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

  const s = update((st) => {
    st.creatives.push(...created);
  });

  audit(
    "creatives",
    parent
      ? `Generated ${created.length} variants from the winner "${parent.headline}"`
      : `Generated ${created.length} variants across ${created.map((c) => c.angle).join(", ")}`,
  );

  return NextResponse.json(s);
}
