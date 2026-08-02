"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Creative, Round, RoundArm } from "@/lib/store";
import { ctr, pct } from "./format";

const RAMP = ["var(--curve-1)", "var(--curve-2)", "var(--curve-3)", "var(--curve-4)"];
const DASH = ["", "7 4", "2 3", "10 3 2 3"];

const VW = 1000;
const VH = 300;
const TOP = 14;
const BASE = 286;
const MAX_READINGS = 40;
const DOT_LIMIT = 12;

interface Reading {
  served: number;
  rates: number[];
}

interface Props {
  cohort: Creative[];
  winnerId: string | null;
  generation: number;
  rounds: Round[];
}

function label(cohort: Creative[], index: number): string {
  const c = cohort[index];
  if (!c) return "variant";
  const twin = cohort.filter((other, i) => i < index && other.angle === c.angle).length;
  return twin > 0 ? `${c.angle} ${twin + 1}` : c.angle;
}

function ticksOf(count: number): number[] {
  if (count <= 1) return [0];
  const wanted = count <= 5 ? count : 4;
  const out = new Set<number>();
  for (let k = 0; k < wanted; k++) {
    out.add(Math.round((k * (count - 1)) / (wanted - 1)));
  }
  return [...out].sort((a, b) => a - b);
}

export default function PerformanceChart({ cohort, winnerId, generation, rounds }: Props) {
  const signature = useMemo(
    () => `${generation}:${cohort.map((c) => c.id).join(",")}`,
    [cohort, generation],
  );
  const [capture, setCapture] = useState<Reading[]>([]);
  const mark = useRef("");

  useEffect(() => {
    const served = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
    const rates = cohort.map((c) => ctr(c.arm.impressions, c.arm.clicks));
    setCapture((prev) => {
      const fresh = mark.current !== signature;
      mark.current = signature;
      if (served === 0) return fresh ? [] : prev;
      if (fresh) return [{ served, rates }];
      const last = prev[prev.length - 1];
      if (last && last.served === served) return prev;
      const next = [...prev, { served, rates }];
      return next.length > MAX_READINGS ? next.slice(next.length - MAX_READINGS) : next;
    });
  }, [cohort, signature]);

  const history = useMemo(() => {
    if (rounds.length === 0 || cohort.length === 0) return [];
    const ids = cohort.map((c) => c.id);
    const readings: Reading[] = [];
    for (const round of rounds) {
      if (round.generation !== generation) continue;
      const byId = new Map(round.arms.map((a) => [a.id, a]));
      const arms: RoundArm[] = [];
      for (const id of ids) {
        const arm = byId.get(id);
        if (arm) arms.push(arm);
      }
      if (arms.length !== ids.length) continue;
      readings.push({
        served: arms.reduce((sum, a) => sum + a.impressions, 0),
        rates: arms.map((a) => ctr(a.impressions, a.clicks)),
      });
    }
    return readings.length > MAX_READINGS
      ? readings.slice(readings.length - MAX_READINGS)
      : readings;
  }, [rounds, cohort, generation]);

  const served = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const winner = winnerId ? cohort.findIndex((c) => c.id === winnerId) : -1;
  const current = cohort.map((c) => ctr(c.arm.impressions, c.arm.clicks));
  const peak = Math.max(...current, 0.005);
  const stored = history.length > 0;
  const kept = stored ? history : capture;
  const shown = kept.length ? kept : served > 0 ? [{ served, rates: current }] : [];

  const legend = cohort.map((c, i) => ({
    name: label(cohort, i),
    color: RAMP[i % RAMP.length],
    dash: DASH[i % DASH.length] || undefined,
    rate: current[i],
    impressions: c.arm.impressions,
    clicks: c.arm.clicks,
  }));

  if (served === 0) {
    return (
      <section className="rounded-2xl border border-white/12 bg-white/[0.03] p-3 sm:p-4">
        <h2 className="t-title text-white">
          Performance over traffic rounds
        </h2>
        <div className="mt-3 flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/12 px-4 text-center sm:h-48">
          <p className="text-[13px] font-medium text-zinc-300">No traffic yet</p>
          <p className="max-w-md break-words text-[12px] leading-relaxed text-zinc-400">
            Serve impressions and every ad gets a line here: its click through rate after each round
            of simulated traffic.
          </p>
        </div>
      </section>
    );
  }

  const ceiling = Math.max(
    0.005,
    shown.reduce((max, r) => Math.max(max, ...r.rates), 0) * 1.2,
  );
  const toY = (rate: number) => BASE - (Math.min(rate, ceiling) / ceiling) * (BASE - TOP);
  const toX = (i: number) => (shown.length > 1 ? (i / (shown.length - 1)) * VW : VW / 2);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ceiling);
  const marks = ticksOf(shown.length);
  const dots = shown.length <= DOT_LIMIT;

  return (
    <section className="rounded-2xl border border-white/12 bg-white/[0.03] p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="t-title text-white">
            Performance over traffic rounds
          </h2>
          <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
            Simulated traffic
          </span>
        </div>
        <span className="text-[11px] tabular-nums text-zinc-400">
          {shown.length} {shown.length === 1 ? "reading" : "readings"},{" "}
          {served.toLocaleString()} impressions served
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {legend.map((c, i) => (
          <span
            key={`${c.name}-${i}`}
            className={`flex items-center gap-1.5 text-[11px] ${
              winner < 0 || winner === i ? "opacity-100" : "opacity-70"
            }`}
          >
            <svg viewBox="0 0 18 6" aria-hidden="true" className="h-1.5 w-[18px] shrink-0">
              <line
                x1="0"
                y1="3"
                x2="18"
                y2="3"
                stroke={c.color}
                strokeWidth="2.5"
                strokeDasharray={c.dash}
                strokeLinecap="round"
              />
            </svg>
            <span className="font-semibold capitalize text-zinc-200">{c.name}</span>
            <span className="tabular-nums text-zinc-400">{pct(c.rate, 2)}</span>
          </span>
        ))}
      </div>

      {shown.length > 1 ? (
        <div className="mt-3 flex gap-2">
          <div className="relative h-44 w-9 shrink-0 sm:h-56">
            {grid.map((g, i) => (
              <span
                key={i}
                className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-zinc-400"
                style={{ top: `${(toY(g) / VH) * 100}%` }}
              >
                {pct(g, ceiling > 0.2 ? 0 : 1)}
              </span>
            ))}
          </div>

          <div className="mx-[3px] min-w-0 flex-1">
            <div className="relative h-44 sm:h-56">
              <svg
                viewBox={`0 0 ${VW} ${VH}`}
                preserveAspectRatio="none"
                role="img"
                aria-label="Click through rate of every ad after each round of simulated traffic"
                className="h-full w-full"
              >
                {grid.map((g, i) => (
                  <line
                    key={i}
                    x1={0}
                    x2={VW}
                    y1={toY(g)}
                    y2={toY(g)}
                    stroke={i === 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.07)"}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {marks.map((m) => (
                  <line
                    key={m}
                    x1={toX(m)}
                    x2={toX(m)}
                    y1={TOP - 6}
                    y2={BASE}
                    stroke="rgba(255,255,255,0.07)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {cohort.map((c, k) => {
                  const points = shown
                    .map((r, i) => `${toX(i).toFixed(2)},${toY(r.rates[k] ?? 0).toFixed(2)}`)
                    .join(" ");
                  return (
                    <polyline
                      key={c.id}
                      points={points}
                      fill="none"
                      stroke={RAMP[k % RAMP.length]}
                      strokeWidth={winner === k ? 3 : 1.8}
                      strokeDasharray={DASH[k % DASH.length] || undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={winner < 0 || winner === k ? 1 : 0.6}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>

              {cohort.map((c, k) =>
                shown.map((r, i) =>
                  dots || i === shown.length - 1 ? (
                    <span
                      key={`${c.id}-${i}`}
                      aria-hidden="true"
                      className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: `${(toX(i) / VW) * 100}%`,
                        top: `${(toY(r.rates[k] ?? 0) / VH) * 100}%`,
                        backgroundColor: RAMP[k % RAMP.length],
                        opacity: winner < 0 || winner === k ? 1 : 0.6,
                      }}
                    />
                  ) : null,
                ),
              )}
            </div>

            <div className="relative mt-1 h-4">
              {marks.map((m, i) => {
                const first = i === 0;
                const last = i === marks.length - 1;
                return (
                  <span
                    key={m}
                    className={`absolute top-0 text-[10px] tabular-nums text-zinc-400 ${
                      first || last ? "" : "-translate-x-1/2"
                    }`}
                    style={first ? { left: 0 } : last ? { right: 0 } : { left: `${(toX(m) / VW) * 100}%` }}
                  >
                    {shown[m].served.toLocaleString()}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          {legend.map((c, i) => (
            <div key={`${c.name}-bar-${i}`} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="min-w-0 truncate text-[12px] font-semibold capitalize text-zinc-200">
                  {c.name}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                  {pct(c.rate, 2)} on {c.impressions.toLocaleString()} impressions
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (c.rate / peak) * 100)}%`,
                    backgroundColor: c.color,
                    opacity: winner < 0 || winner === i ? 1 : 0.6,
                  }}
                />
              </div>
            </div>
          ))}
          <p className="break-words text-[11px] leading-relaxed text-zinc-400">
            One reading so far, so this is where each ad stands right now. Serve another round and
            the readings turn into lines.
          </p>
        </div>
      )}

      <p className="mt-2.5 break-words text-[11px] leading-relaxed text-zinc-400">
        Every point is one reading of the click through rate, taken after a round of simulated
        traffic. The x axis counts impressions served to the live generation.{" "}
        {stored
          ? "This history is saved with the run, so a reload keeps it."
          : "This run started before rounds were saved, so its history lives in this browser tab and a reload starts it over."}
      </p>
    </section>
  );
}
