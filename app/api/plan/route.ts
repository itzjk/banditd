import { NextResponse } from "next/server";
import { logAudit } from "@/lib/store";
import { guard } from "@/lib/access";
import { readRun, updateRun } from "@/lib/run-store";
import { failure, readJson } from "@/lib/http";
import { PlanInput } from "@/lib/contracts";
import { chooseNextAction, startBudget } from "@/lib/openai";
import { mandateQueue } from "@/lib/mandate";
import {
  PLAN_ACTIONS,
  ACTION_LABEL,
  MAX_PLAN_CYCLES,
  buildSnapshot,
  clampImpressions,
  isPlanAction,
  renderSnapshot,
  scriptedNext,
} from "@/lib/plan";
import type { PlanChoice, PlanMandate, PlanProgress, PlanResult } from "@/lib/plan";

export const maxDuration = 120;

const BUDGET_MS = Number(process.env.PLAN_BUDGET_MS ?? 45000);
const CREDIT_PRICE = process.env.RENDER_CREDIT_PRICE ?? "4.00";

const ACTION_DESCRIPTION: Record<string, string> = {
  research:
    "Read the live web for who buys this product, what angles competitors run and where the price sits. Writes the buyer profile the creatives are written from.",
  creatives:
    "Write four fresh ad variants with images and load them into the bandit as a new generation. Refused if there is no research yet.",
  serve_traffic:
    "Run the simulated auction and allocate a block of impressions across the live variants by Thompson sampling, then re-read the four gates. Say how many impressions in the impressions field. A useful block is between 2,000 and 20,000, and it is split across the live variants, so the leader only receives part of it while the traffic gate counts the leader alone. Each block costs one cycle, so a block far too small burns a cycle without moving the evidence.",
  evaluate:
    "Re-read the posteriors and ask for a justified verdict on whether the leading variant has earned the spend. Only worth doing after new traffic has landed.",
  purchase:
    "Charge the seller's signed mandate for one pack of render credits. The server recomputes the four gates and Prava enforces the mandate, so this is refused unless the evidence and the mandate both allow it. The amount charged and the justification written on the receipt are the ones the last evaluate produced, so charging without a fresh spend decision on the current evidence buys blind and leaves the seller a receipt with no reason on it.",
  evolve:
    "Breed four mutations of the winning variant into the next generation. Only useful once a charge has paid for the render credits they burn.",
  stop: "End the run here and say why. Use this when nothing left to do would change the outcome.",
};

function lines(value: string[]): string[] {
  return value.map((item) => item.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 240)).slice(-12);
}

function sentence(value: string | null): string | null {
  if (value === null) return null;
  const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, 400);
  return clean.length ? clean : null;
}

async function readMandate(mandateId: string | null): Promise<PlanMandate> {
  try {
    const queue = await mandateQueue(Number(CREDIT_PRICE), mandateId, process.env.PRAVA_USER_ID);
    if (queue.listError) {
      return {
        chargeable: 0,
        remaining: "unknown, Prava did not answer the mandate listing",
        note: "Deciding without live mandate data. A charge may still work or may be refused.",
      };
    }
    const pool = queue.candidates.reduce((sum, m) => sum + m.remaining, 0);
    if (queue.candidates.length === 0) {
      return {
        chargeable: 0,
        remaining: "no signed mandate is chargeable in this cycle",
        note: "A Prava mandate on a monthly frequency allows one charge per cycle, and every signed mandate is already charged in this one. A purchase now will be refused, no money can move until the seller signs another mandate.",
      };
    }
    return {
      chargeable: queue.candidates.length,
      remaining: `${queue.candidates.length} signed mandate(s) still chargeable this cycle, ${pool.toFixed(2)} USD total left on them`,
      note: "One charge per mandate per monthly cycle.",
    };
  } catch {
    return {
      chargeable: 0,
      remaining: "unknown, the mandate listing failed",
      note: "Deciding without live mandate data.",
    };
  }
}

function guardChoice(choice: PlanChoice): PlanChoice {
  if (choice.action === "serve_traffic") {
    return { ...choice, impressions: clampImpressions(choice.impressions) };
  }
  return { ...choice, impressions: null };
}

export async function POST(req: Request) {
  try {
    const client = await guard(req, "model");
    const body = await readJson(req, PlanInput);
    const { state } = await readRun(body.runId, client);

    const cycle = Math.min(MAX_PLAN_CYCLES, body.cycle);
    const progress: PlanProgress = body.progress;
    const mandate = await readMandate(state.mandateId);

    const snapshot = buildSnapshot({
      state,
      cycle,
      progress,
      history: lines(body.history),
      mandate,
      creditPrice: CREDIT_PRICE,
      lastDecision: sentence(body.lastDecision),
      lastPurchase: sentence(body.lastPurchase),
    });

    const started = Date.now();
    const budget = startBudget("The next action", BUDGET_MS);

    const answer = async (payload: PlanResult, audit: string) => {
      const { record } = await updateRun(body.runId, client, ({ state: latest }) =>
        logAudit(latest, "plan", audit),
      );
      return NextResponse.json({ ...payload, state: record.state });
    };

    const giveUp = (why: string) => {
      const choice = scriptedNext(snapshot);
      return answer(
        { choice, source: "fallback", fallbackBecause: why, snapshot, tookMs: Date.now() - started },
        `Cycle ${cycle}: the agent could not choose (${why}), so the run fell back to the scripted order and takes ${ACTION_LABEL[choice.action]}.`,
      );
    };

    let picked;
    try {
      picked = await chooseNextAction(
        { actions: PLAN_ACTIONS, descriptions: ACTION_DESCRIPTION, briefing: renderSnapshot(snapshot) },
        budget,
      );
    } catch (err) {
      console.error(`plan gave up after ${Math.round((Date.now() - started) / 1000)}s`, err);
      return giveUp("the model call failed");
    }

    if (!isPlanAction(picked.action)) {
      return giveUp(
        picked.action
          ? `the model asked for "${String(picked.action)}", which is not an action`
          : "the model chose no action",
      );
    }

    const reason = sentence(picked.reason);
    if (!reason) return giveUp("the model chose an action without giving a reason");

    const choice = guardChoice({ action: picked.action, reason, impressions: picked.impressions });

    return answer(
      { choice, source: "model", fallbackBecause: null, snapshot, tookMs: Date.now() - started },
      `Cycle ${cycle}: the agent chose to ${ACTION_LABEL[choice.action]}${
        choice.impressions ? ` with ${choice.impressions.toLocaleString("en-US")} more impressions` : ""
      }. ${choice.reason}`,
    );
  } catch (err) {
    return failure(err);
  }
}
