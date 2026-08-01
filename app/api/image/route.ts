import { NextResponse } from "next/server";
import { generateImage, isAngle, startBudget } from "@/lib/openai";

export const maxDuration = 300;

const IMAGE_BUDGET_MS = Number(process.env.CREATIVES_IMAGE_BUDGET_MS ?? 90000);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    creativeId?: unknown;
    imagePrompt?: unknown;
    angle?: unknown;
  };

  const creativeId = typeof body.creativeId === "string" ? body.creativeId.trim() : "";
  const imagePrompt = typeof body.imagePrompt === "string" ? body.imagePrompt.trim() : "";
  const angle = isAngle(body.angle) ? body.angle : undefined;

  if (!creativeId) {
    return NextResponse.json({ error: "no creative id given" }, { status: 400 });
  }
  if (!imagePrompt) {
    return NextResponse.json({ error: "no image prompt given" }, { status: 400 });
  }

  const budget = startBudget("Image render", IMAGE_BUDGET_MS);
  const imageData = await generateImage(imagePrompt, budget, angle);

  if (!imageData) {
    return NextResponse.json(
      {
        error: "The image render came back empty. Nothing was charged, the ad copy is unaffected.",
        code: "IMAGE_FAILED",
        creativeId,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ creativeId, imageData });
}
