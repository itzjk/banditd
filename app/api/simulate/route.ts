import { NextResponse } from "next/server";
import { openSession, commit, logAudit } from "@/lib/store";
import type { Creative } from "@/lib/store";
import { simulateTraffic } from "@/lib/bandit";

const MIN_RATE = 0.015;
const MAX_RATE = 0.065;

const INHERITANCE = 0.75;
const MUTATION = 0.28;

function unitFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function hiddenRate(creative: Creative, byId: Map<string, Creative>): number {
  const seed = unitFrom(creative.id);
  const parent = creative.parentId ? byId.get(creative.parentId) : undefined;
  if (!parent) return MIN_RATE + seed * (MAX_RATE - MIN_RATE);

  const inherited = hiddenRate(parent, byId);
  const drift = (seed - 0.5) * 2 * MUTATION;
  const rate = inherited * (INHERITANCE + (1 - INHERITANCE) * 2 * seed) * (1 + drift);
  return Math.min(MAX_RATE * 1.6, Math.max(MIN_RATE * 0.6, rate));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { impressions?: number; state?: unknown };
  const impressions = body.impressions ?? 1000;

  const session = openSession(body.state);
  const state = session.state;

  if (state.creatives.length === 0) {
    return NextResponse.json({ error: "no creatives to simulate" }, { status: 400 });
  }

  const generation = Math.max(...state.creatives.map((c) => c.generation));
  const live = state.creatives.filter((c) => c.generation === generation);

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

  logAudit(
    state,
    "simulate",
    `Injected ${impressions} impressions across ${live.length} generation ${generation} creatives`,
  );

  return NextResponse.json(commit(session));
}
