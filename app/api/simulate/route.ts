import { NextResponse } from "next/server";
import { getState, update, audit } from "@/lib/store";
import { simulateTraffic } from "@/lib/bandit";

const MIN_RATE = 0.015;
const MAX_RATE = 0.065;

function hiddenRate(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = ((h >>> 0) % 100000) / 100000;
  return MIN_RATE + unit * (MAX_RATE - MIN_RATE);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { impressions?: number };
  const impressions = body.impressions ?? 1000;

  const state = getState();
  if (state.creatives.length === 0) {
    return NextResponse.json({ error: "no creatives to simulate" }, { status: 400 });
  }

  const generation = Math.max(...state.creatives.map((c) => c.generation));
  const live = state.creatives.filter((c) => c.generation === generation);

  const served = simulateTraffic(
    live.map((c) => c.arm),
    live.map((c) => hiddenRate(c.id)),
    impressions,
    Math.random,
    "thompson",
  );

  const s = update((st) => {
    live.forEach((c, i) => {
      const target = st.creatives.find((x) => x.id === c.id);
      if (!target) return;
      target.arm.impressions = served[i].impressions;
      target.arm.clicks = served[i].clicks;
    });
    st.simulatedImpressions += impressions;
  });

  audit(
    "simulate",
    `Injected ${impressions} impressions across ${live.length} generation ${generation} creatives`,
  );

  return NextResponse.json(s);
}
