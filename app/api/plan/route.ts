import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { openSession, logAudit, commit } from "@/lib/store";
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

function progressOf(value: unknown): PlanProgress {
  const raw = (value ?? {}) as Record<string, unknown>;
  const looksTaken = Math.max(0, Math.floor(Number(raw.looksTaken) || 0));
  const looksLeft = Math.max(0, Math.floor(Number(raw.looksLeft) || 0));
  return {
    researched: raw.researched === true,
    wrote: raw.wrote === true,
    decided: raw.decided === true,
    purchaseAttempts: Math.max(0, Math.floor(Number(raw.purchaseAttempts) || 0)),
    purchased: raw.purchased === true,
    evolved: raw.evolved === true,
    retested: raw.retested === true,
    looksTaken,
    looksLeft,
  };
}

function lines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 240))
    .slice(-12);
}

function sentence(value: unknown): string | null {
  if (typeof value !== "string") return null;
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
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    state?: unknown;
    cycle?: unknown;
    progress?: unknown;
    history?: unknown;
    lastDecision?: unknown;
    lastPurchase?: unknown;
  };

  const session = openSession(body.state);
  const state = session.state;

  const cycle = Math.min(MAX_PLAN_CYCLES, Math.max(1, Math.floor(Number(body.cycle) || 1)));
  const progress = progressOf(body.progress);
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

  const giveUp = (why: string): NextResponse => {
    const choice = scriptedNext(snapshot);
    logAudit(
      state,
      "plan",
      `Cycle ${cycle}: the agent could not choose (${why}), so the run fell back to the scripted order and takes ${ACTION_LABEL[choice.action]}.`,
    );
    const payload: PlanResult = {
      choice,
      source: "fallback",
      fallbackBecause: why,
      snapshot,
      tookMs: Date.now() - started,
    };
    return NextResponse.json({ ...payload, state: commit(session) });
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
      picked.action ? `the model asked for "${String(picked.action)}", which is not an action` : "the model chose no action",
    );
  }

  const reason = sentence(picked.reason);
  if (!reason) return giveUp("the model chose an action without giving a reason");

  const choice = guardChoice({ action: picked.action, reason, impressions: picked.impressions });

  logAudit(
    state,
    "plan",
    `Cycle ${cycle}: the agent chose to ${ACTION_LABEL[choice.action]}${
      choice.impressions ? ` with ${choice.impressions.toLocaleString("en-US")} more impressions` : ""
    }. ${choice.reason}`,
  );

  const payload: PlanResult = {
    choice,
    source: "model",
    fallbackBecause: null,
    snapshot,
    tookMs: Date.now() - started,
  };

  return NextResponse.json({ ...payload, state: commit(session) });
}
