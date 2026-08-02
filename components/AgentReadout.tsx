"use client";

import { useMemo } from "react";
import type { Creative } from "@/lib/store";
import { createRng, sampleBeta, DEFAULT_PRIOR_ALPHA, DEFAULT_PRIOR_BETA } from "@/lib/bandit";
import { ctr, pct } from "./format";

const RAMP = ["var(--curve-1)", "var(--curve-2)", "var(--curve-3)", "var(--curve-4)"];
const DRAWS = 3000;
const PARKED = 5;

interface Props {
  cohort: Creative[];
  generation: number;
  evaluation: { probabilityBest: number; sufficientEvidence: boolean } | null;
  winnerId: string | null;
}

function label(cohort: Creative[], index: number): string {
  const c = cohort[index];
  if (!c) return "variant";
  const twin = cohort.filter((other, i) => i < index && other.angle === c.angle).length;
  return twin > 0 ? `${c.angle} ${twin + 1}` : c.angle;
}

function thompsonShare(cohort: Creative[]): number[] {
  const seed = cohort.reduce((acc, c) => acc + c.arm.impressions * 31 + c.arm.clicks * 7, 17);
  const rng = createRng(seed);
  const alpha = cohort.map((c) => c.arm.clicks + DEFAULT_PRIOR_ALPHA);
  const beta = cohort.map((c) => c.arm.impressions - c.arm.clicks + DEFAULT_PRIOR_BETA);
  const wins = new Array<number>(cohort.length).fill(0);
  for (let s = 0; s < DRAWS; s += 1) {
    let leader = 0;
    let best = -1;
    for (let k = 0; k < cohort.length; k += 1) {
      const draw = sampleBeta(alpha[k], beta[k], rng);
      if (draw > best) {
        best = draw;
        leader = k;
      }
    }
    wins[leader] += 1;
  }
  return wins.map((w) => w / DRAWS);
}

function wholePercents(values: number[]): number[] {
  const raw = values.map((v) => v * 100);
  const out = raw.map((v) => Math.floor(v));
  let left = 100 - out.reduce((sum, v) => sum + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const item of order) {
    if (left <= 0) break;
    out[item.i] += 1;
    left -= 1;
  }
  return out;
}

function Row({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <>
      <span className="shrink-0 whitespace-nowrap text-zinc-400">{tag}</span>
      <span className="min-w-0 break-words text-zinc-100 [overflow-wrap:anywhere]">{children}</span>
    </>
  );
}

export default function AgentReadout({ cohort, generation, evaluation, winnerId }: Props) {
  const served = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const shares = useMemo(() => {
    const total = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
    if (cohort.length === 0 || total === 0) return [];
    return wholePercents(thompsonShare(cohort));
  }, [cohort]);

  if (cohort.length === 0 || served === 0) return null;

  const clicks = cohort.reduce((sum, c) => sum + c.arm.clicks, 0);
  const average = ctr(served, clicks);
  const rates = cohort.map((c) => ctr(c.arm.impressions, c.arm.clicks));

  let top = 0;
  for (let k = 1; k < cohort.length; k += 1) if (rates[k] > rates[top]) top = k;
  const leadName = label(cohort, top);
  const leadLift = average > 0 ? rates[top] / average - 1 : 0;

  const ranked = cohort
    .map((c, i) => ({ name: label(cohort, i), share: shares[i] ?? 0 }))
    .sort((a, b) => b.share - a.share);
  const first = ranked[0];
  const even = Math.round(100 / cohort.length);
  const parked = ranked.filter((r) => r.share < PARKED);

  const rest = parked.length
    ? `, and park ${parked.map((r) => `${r.name} ${r.share}%`).join(", ")}`
    : ", and keep the rest running";
  const action =
    first && first.share > even
      ? `raise ${first.name} to ${first.share}% of the next impressions, up from the ${even}% an even split gives${rest}`
      : "hold the split even, no ad has pulled far enough ahead to earn more traffic";

  return (
    <section className="rounded-2xl border border-white/12 bg-white/[0.03] p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-white sm:text-base">
            What the agent is reading
          </h2>
          <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            Simulated traffic
          </span>
        </div>
        <span className="text-[12px] tabular-nums text-zinc-400">
          Generation {generation}, {served.toLocaleString()} impressions
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 font-mono text-[11px] leading-snug sm:text-[12px]">
          <Row tag="ANALYZING">
            {cohort.length} ads, {served.toLocaleString()} simulated impressions,{" "}
            {clicks.toLocaleString()} clicks
          </Row>

          {cohort.map((c, i) => (
            <Row key={c.id} tag="CTR">
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ backgroundColor: RAMP[i % RAMP.length] }}
              />
              <span className="capitalize text-zinc-100">{label(cohort, i)}</span>{" "}
              <span className="font-semibold tabular-nums text-white">{pct(rates[i], 2)}</span>{" "}
              <span className="text-zinc-400">
                on {c.arm.impressions.toLocaleString()} impressions
                {winnerId === c.id ? ", picked as the candidate" : ""}
              </span>
            </Row>
          ))}

          <Row tag="LEADING">
            <span className="capitalize">{leadName}</span> at {pct(rates[top], 2)},{" "}
            {leadLift > 0.005
              ? `${(leadLift * 100).toFixed(0)}% over the ${pct(average, 2)} average`
              : `level with the ${pct(average, 2)} average`}
          </Row>

          <Row tag="CONFIDENCE">
            {evaluation
              ? `${pct(evaluation.probabilityBest, 1)} probability best, ${
                  evaluation.sufficientEvidence ? "gates cleared" : "gates still open"
                }`
              : "not read yet, run the decision step"}
          </Row>

          <Row tag="NEXT SPLIT">
            <span className="capitalize tabular-nums">
              {ranked.map((r) => `${r.name} ${r.share}%`).join(", ")}
            </span>
          </Row>

          <Row tag="ACTION">{action}</Row>
        </div>
      </div>

      <p className="mt-2.5 break-words text-[12px] leading-relaxed text-zinc-400">
        Every line is read off this run. Click through rates come from simulated traffic. The split
        is the share of the next impressions Thompson sampling would send each ad, so it is traffic
        and not dollars: the money in this demo buys render credits, not media.
      </p>
    </section>
  );
}
