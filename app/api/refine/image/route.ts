import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { generateVariantImage, startBudget } from "@/lib/openai";
import { sanitizeRefinement } from "@/lib/store";

export const maxDuration = 300;

const SHOT_BUDGET_MS = Number(process.env.REFINE_IMAGE_BUDGET_MS ?? 90000);

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    productName?: unknown;
    variant?: unknown;
  };

  const productName = typeof body.productName === "string" ? body.productName.trim() : "";
  const variant = sanitizeRefinement(body.variant);

  if (!productName) {
    return NextResponse.json({ error: "no product name given" }, { status: 400 });
  }
  if (!variant) {
    return NextResponse.json({ error: "no variant given" }, { status: 400 });
  }

  const imageData = await generateVariantImage(
    productName.slice(0, 120),
    variant,
    startBudget("The variant shot", SHOT_BUDGET_MS),
  );

  if (!imageData) {
    return NextResponse.json(
      {
        error: "That variant shot came back empty. The variant is still selectable without it.",
        code: "SHOT_FAILED",
        variant,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ variant, imageData });
}
