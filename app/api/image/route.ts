import { NextResponse } from "next/server";
import { logAudit, logCredit } from "@/lib/store";
import { generateImage, startBudget, failureBody } from "@/lib/openai";
import { guard } from "@/lib/access";
import { updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { ImageInput } from "@/lib/contracts";

export const maxDuration = 300;

const IMAGE_BUDGET_MS = Number(process.env.CREATIVES_IMAGE_BUDGET_MS ?? 90000);

/**
 * Renders the picture of a creative the server wrote, from the prompt the
 * server stored with it. The credit is taken first, in one atomic write, so
 * parallel renders cannot all spend the same last credit; a render that
 * fails hands its credit back.
 */
export async function POST(req: Request) {
  try {
    const client = await guard(req, "image");
    const { runId, creativeId } = await readJson(req, ImageInput);

    const debit = await updateRun(runId, client, ({ state }) => {
      const creative = state.creatives.find((c) => c.id === creativeId);
      if (!creative) {
        throw new HttpFailure("CREATIVE_NOT_FOUND", 404, `creative ${creativeId} is not on this run`);
      }
      if (state.credits.balance <= 0) {
        logAudit(
          state,
          "credits",
          `Refused to render ${creativeId}: the ledger holds 0 render credits, so there is nothing to deliver against.`,
        );
        return null;
      }
      logCredit(state, "render", -1, creativeId);
      logAudit(
        state,
        "credits",
        `Debited 1 render credit to render ${creativeId}, ${state.credits.balance} left on the ledger`,
      );
      return creative.imagePrompt;
    });

    const prompt = debit.result;
    if (prompt === null) {
      throw new HttpFailure(
        "NO_CREDITS",
        402,
        "No render credits left. The agent has to buy more through the mandate before it can render.",
        { extra: { creativeId, state: debit.record.state } },
      );
    }

    let imageData: string;
    try {
      imageData = await generateImage(prompt, startBudget("Image render", IMAGE_BUDGET_MS));
    } catch (renderError) {
      const { status, body } = failureBody(renderError);
      const refund = await updateRun(runId, client, ({ state }) => {
        logCredit(state, "refund", 1, creativeId);
        logAudit(
          state,
          "credits",
          `The render of ${creativeId} failed (${body.code}), so its credit went back on the ledger, ${state.credits.balance} left`,
        );
      });
      return NextResponse.json({ ...body, creativeId, state: refund.record.state }, { status });
    }

    return NextResponse.json({ creativeId, imageData, state: debit.record.state });
  } catch (err) {
    return failure(err);
  }
}
