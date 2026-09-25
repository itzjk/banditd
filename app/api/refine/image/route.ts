import { NextResponse } from "next/server";
import { generateVariantImage, startBudget, failureBody } from "@/lib/openai";
import { guard } from "@/lib/access";
import { updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { VariantImageInput } from "@/lib/contracts";

export const maxDuration = 300;

const SHOT_BUDGET_MS = Number(process.env.REFINE_IMAGE_BUDGET_MS ?? 90000);

/**
 * One catalogue shot per variant the model listed for this run, drawn at most
 * once. The product name and the variant come from the run, not the request,
 * so this cannot be pointed at an arbitrary prompt.
 */
export async function POST(req: Request) {
  try {
    const client = await guard(req, "image");
    const { runId, variant } = await readJson(req, VariantImageInput);

    const claim = await updateRun(runId, client, (record) => {
      const product = record.state.product;
      if (!product) throw new HttpFailure("NO_PRODUCT", 400, "no product submitted yet");
      const listed = record.state.productOptions?.variants ?? [];
      const match = listed.find((v) => v.toLowerCase() === variant.toLowerCase());
      if (!match) {
        throw new HttpFailure(
          "VARIANT_NOT_LISTED",
          404,
          `"${variant}" is not one of the variants listed for this product, so no shot was drawn.`,
        );
      }
      const key = match.toLowerCase();
      if (record.shots.includes(key)) {
        throw new HttpFailure(
          "SHOT_ALREADY_DRAWN",
          409,
          `The ${match} shot was already drawn for this run. Each variant is drawn once.`,
        );
      }
      record.shots.push(key);
      return { productName: product.name, variant: match, key };
    });

    const { productName, key } = claim.result;
    try {
      const imageData = await generateVariantImage(
        productName,
        claim.result.variant,
        startBudget("The variant shot", SHOT_BUDGET_MS),
      );
      return NextResponse.json({ variant: claim.result.variant, imageData });
    } catch (renderError) {
      // Give the variant its turn back so a later request can draw it.
      await updateRun(runId, client, (record) => {
        record.shots = record.shots.filter((s) => s !== key);
      });
      const { status, body } = failureBody(renderError);
      return NextResponse.json({ ...body, variant: claim.result.variant }, { status });
    }
  } catch (err) {
    return failure(err);
  }
}
