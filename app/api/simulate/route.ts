import { NextResponse } from "next/server";
import { logAudit, logRound, liveCohort } from "@/lib/store";
import type { Creative } from "@/lib/store";
import { simulateTraffic } from "@/lib/bandit";
import { guard } from "@/lib/access";
import { updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { SimulateInput } from "@/lib/contracts";

const MIN_RATE = 0.015;
const MAX_RATE = 0.065;

const INHERITANCE = 0.75;
const MUTATION = 0.28;
const MAX_LINEAGE = 64;

function unitFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function hiddenRate(
  creative: Creative,
  byId: Map<string, Creative>,
  visited: Set<string> = new Set(),
): number {
  const seed = unitFrom(creative.id);
  const base = MIN_RATE + seed * (MAX_RATE - MIN_RATE);
  if (visited.has(creative.id) || visited.size >= MAX_LINEAGE) return base;

  const parent = creative.parentId ? byId.get(creative.parentId) : undefined;
  if (!parent) return base;

  visited.add(creative.id);
  const inherited = hiddenRate(parent, byId, visited);
  const drift = (seed - 0.5) * 2 * MUTATION;
  const rate = inherited * (INHERITANCE + (1 - INHERITANCE) * 2 * seed) * (1 + drift);
  return Math.min(MAX_RATE * 1.6, Math.max(MIN_RATE * 0.6, rate));
}

/**
 * The only writer of impressions and clicks. The counts every gate, decision
 * and charge reads come from here, drawn on the server against creatives the
 * server wrote.
 */
export async function POST(req: Request) {
  try {
    const client = await guard(req, "simulate");
    const { runId, impressions } = await readJson(req, SimulateInput);

    const { record } = await updateRun(runId, client, ({ state }) => {
      const live = liveCohort(state);
      if (live.length === 0) {
        throw new HttpFailure("NO_CREATIVES", 400, "no creatives to simulate");
      }
      const generation = live[0].generation;
      const byId = new Map(state.creatives.map((c) => [c.id, c]));

      const served = simulateTraffic(
        live.map((c) => c.arm),
        live.map((c) => hiddenRate(c, byId)),
        impressions,
        Math.random,
        "thompson",
      );

      live.forEach((c, i) => {
        c.arm.impressions = served[i].impressions;
        c.arm.clicks = served[i].clicks;
      });
      state.simulatedImpressions += impressions;

      logRound(
        state,
        generation,
        impressions,
        live.map((c) => ({ id: c.id, impressions: c.arm.impressions, clicks: c.arm.clicks })),
      );
      logAudit(
        state,
        "simulate",
        `Injected ${impressions} impressions across ${live.length} generation ${generation} creatives`,
      );
    });

    return NextResponse.json(record.state);
  } catch (err) {
    return failure(err);
  }
}
