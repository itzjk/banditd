"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Creative } from "@/lib/store";
import { DEFAULT_PRIOR_ALPHA, DEFAULT_PRIOR_BETA, logBetaFn } from "@/lib/bandit";
import { ctr, pct } from "./format";

interface Props {
  creatives: Creative[];
  winnerIndex?: number | null;
}

interface Params {
  a: number;
  b: number;
}

interface Curve {
  line: string;
  area: string;
  color: string;
  dash?: string;
  label: string;
  mean: number;
  impressions: number;
  clicks: number;
  rate: number;
}

interface View {
  lo: number;
  hi: number;
  curves: Curve[];
  ticks: number[];
  digits: number;
}

const POINTS = 33;
const DURATION = 720;
const VW = 1000;
const VH = 320;
const TOP = 16;
const BASE = 294;
const EDGE = 1e-4;

const RAMP = ["var(--curve-1)", "var(--curve-2)", "var(--curve-3)", "var(--curve-4)"];

const DASH = ["", "7 4", "2 3", "10 3 2 3"];

function paramsOf(c: Creative): Params {
  return {
    a: Math.max(EDGE, c.arm.clicks + DEFAULT_PRIOR_ALPHA),
    b: Math.max(EDGE, c.arm.impressions - c.arm.clicks + DEFAULT_PRIOR_BETA),
  };
}

function meanOf(p: Params): number {
  return p.a / (p.a + p.b);
}

function sdOf(p: Params): number {
  const n = p.a + p.b;
  return Math.sqrt((p.a * p.b) / (n * n * (n + 1)));
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function logDensity(x: number, p: Params, norm: number): number {
  return (p.a - 1) * Math.log(x) + (p.b - 1) * Math.log1p(-x) - norm;
}

function smooth(points: [number, number][]): string {
  if (points.length === 0) return "";
  const at = (i: number) => points[clamp(i, 0, points.length - 1)];
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = clamp(y1 + (y2 - y0) / 6, TOP, BASE);
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = clamp(y2 - (y3 - y1) / 6, TOP, BASE);
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${x2.toFixed(
      2,
    )} ${y2.toFixed(2)}`;
  }
  return d;
}

function buildView(params: Params[], creatives: Creative[]): View {
  const stats = params.map((p) => ({ mean: meanOf(p), sd: sdOf(p) }));

  let rawLo = 1;
  let rawHi = 0;
  for (const s of stats) {
    rawLo = Math.min(rawLo, s.mean - 4.5 * s.sd);
    rawHi = Math.max(rawHi, s.mean + 4.5 * s.sd);
  }
  const spread = Math.max(rawHi - rawLo, 0.002);
  let lo = clamp(rawLo - 0.3 * spread, 0, 1);
  let hi = clamp(rawHi + 0.12 * spread, 0, 1);
  if (hi - lo < 0.002) {
    const mid = (hi + lo) / 2;
    lo = clamp(mid - 0.001, 0, 1);
    hi = clamp(mid + 0.001, 0, 1);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    lo = 0;
    hi = 1;
  }

  const grids = params.map((p, i) => {
    const s = stats[i];
    const from = clamp(Math.max(lo, s.mean - 5 * s.sd), EDGE, 1 - EDGE);
    const to = clamp(Math.min(hi, s.mean + 5 * s.sd), EDGE, 1 - EDGE);
    const left = to > from ? from : clamp(lo, EDGE, 1 - EDGE);
    const right = to > from ? to : clamp(hi, EDGE, 1 - EDGE);
    const norm = logBetaFn(p.a, p.b);
    const xs: number[] = [];
    const logs: number[] = [];
    for (let k = 0; k < POINTS; k++) {
      const x = left + ((right - left) * k) / (POINTS - 1);
      xs.push(x);
      logs.push(logDensity(x, p, norm));
    }
    return { xs, logs };
  });

  let peak = -Infinity;
  for (const g of grids) for (const l of g.logs) if (Number.isFinite(l) && l > peak) peak = l;
  if (!Number.isFinite(peak)) peak = 0;

  const width = hi - lo || 1;
  const toX = (x: number) => ((x - lo) / width) * VW;
  const toY = (value: number) => BASE - value * (BASE - TOP);

  const curves = grids.map((g, i) => {
    const creative = creatives[i];
    const twin = creatives.filter((c, k) => k < i && c.angle === creative?.angle).length;
    const points: [number, number][] = g.xs.map((x, k) => {
      const value = Math.exp(Math.min(0, g.logs[k] - peak));
      return [toX(x), toY(Number.isFinite(value) ? value : 0)];
    });
    const line = smooth(points);
    const area = `${line} L ${points[points.length - 1][0].toFixed(2)} ${BASE} L ${points[0][0].toFixed(
      2,
    )} ${BASE} Z`;
    const impressions = creative?.arm.impressions ?? 0;
    const clicks = creative?.arm.clicks ?? 0;
    return {
      line,
      area,
      color: RAMP[i % RAMP.length],
      dash: DASH[i % DASH.length] || undefined,
      label: `${creative?.angle ?? "variant"}${twin > 0 ? ` ${twin + 1}` : ""}`,
      mean: meanOf(params[i]),
      impressions,
      clicks,
      rate: ctr(impressions, clicks),
    };
  });

  const span = hi - lo;
  const digits = span > 0.2 ? 0 : span > 0.05 ? 1 : 2;
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + (span * k) / 4);

  return { lo, hi, curves, ticks, digits };
}

export default function PosteriorChart({ creatives, winnerIndex }: Props) {
  const target = useMemo(() => creatives.map(paramsOf), [creatives]);
  const [shown, setShown] = useState<Params[]>(() =>
    target.map(() => ({ a: DEFAULT_PRIOR_ALPHA, b: DEFAULT_PRIOR_BETA })),
  );
  const current = useRef<Params[]>(shown);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const span = reduced ? 0 : DURATION;
    const from =
      current.current.length === target.length
        ? current.current
        : target.map(() => ({ a: DEFAULT_PRIOR_ALPHA, b: DEFAULT_PRIOR_BETA }));

    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = span > 0 ? Math.min(1, (now - start) / span) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      const next = target.map((to, i) => ({
        a: from[i].a + (to.a - from[i].a) * eased,
        b: from[i].b + (to.b - from[i].b) * eased,
      }));
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const winner = typeof winnerIndex === "number" && winnerIndex >= 0 ? winnerIndex : null;
  const served = creatives.reduce((sum, c) => sum + c.arm.impressions, 0);
  const drawn = shown.length === creatives.length ? shown : target;
  const view = useMemo(
    () => (drawn.length === creatives.length ? buildView(drawn, creatives) : null),
    [drawn, creatives],
  );

  if (creatives.length === 0 || served === 0 || !view) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
        <h2 className="t-title text-white">What the agent believes</h2>
        <div className="mt-3 flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/12 px-4 text-center sm:h-48">
          <p className="text-[13px] font-medium text-zinc-300">No impressions yet</p>
          <p className="max-w-md text-[12px] leading-relaxed text-zinc-400">
            Once traffic runs, every variant gets a curve here: what the agent believes its click
            rate could be.
          </p>
        </div>
      </section>
    );
  }

  const spread = view.hi - view.lo;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="t-title text-white">What the agent believes</h2>
        <span className="text-[11px] text-zinc-400">
          Posterior click rate per variant, {served.toLocaleString()} simulated impressions
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {view.curves.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            className={`flex items-center gap-1.5 text-[11px] transition-opacity ${
              winner === null || winner === i ? "opacity-100" : "opacity-60"
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
            <span className="font-semibold capitalize text-zinc-200">{c.label}</span>
            <span className="tabular-nums text-zinc-400">{pct(c.rate, 2)}</span>
            {winner === i ? (
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-950">
                Candidate
              </span>
            ) : null}
          </span>
        ))}
      </div>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Posterior click rate density for every variant in the run"
          className="h-44 w-full sm:h-56"
        >
          <defs>
            {view.curves.map((c, i) => (
              <linearGradient key={i} id={`posterior-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.color} stopOpacity={winner === i ? 0.34 : 0.18} />
                <stop offset="100%" stopColor={c.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>

          {view.ticks.map((t, i) => (
            <line
              key={i}
              x1={((t - view.lo) / (spread || 1)) * VW}
              x2={((t - view.lo) / (spread || 1)) * VW}
              y1={TOP - 8}
              y2={BASE}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <line
            x1={0}
            x2={VW}
            y1={BASE}
            y2={BASE}
            stroke="rgba(255,255,255,0.16)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          {view.curves.map((c, i) => {
            const dim = winner !== null && winner !== i;
            return (
              <g key={i} opacity={dim ? 0.5 : 1}>
                <path d={c.area} fill={`url(#posterior-fill-${i})`} />
                <path
                  d={c.line}
                  fill="none"
                  stroke={c.color}
                  strokeWidth={winner === i ? 3 : 1.6}
                  strokeDasharray={c.dash}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>

        <div className="relative mt-1 h-4">
          {view.ticks.map((t, i) => (
            <span
              key={i}
              className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-zinc-400"
              style={{ left: `${clamp(((t - view.lo) / (spread || 1)) * 100, 3, 97)}%` }}
            >
              {pct(t, view.digits)}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
        Each curve is one variant, and it covers the click rates the agent still considers possible.
        Wide is uncertainty, narrow is confidence. Serve more impressions and the curves tighten. One
        curve pulling clear of the rest is not enough on its own, which is what the four gates are
        for.
      </p>
    </section>
  );
}
