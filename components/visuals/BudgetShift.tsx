"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { prefersReducedMotion, useInView } from "./useInView";

export interface BudgetShiftProps {
  className?: string;
  budget?: number;
  labels?: readonly [string, string, string, string];
  start?: readonly [number, number, number, number];
  end?: readonly [number, number, number, number];
  rates?: readonly [string, string, string, string];
  budgetLabel?: string;
  rateLabel?: string;
  phaseLabels?: readonly [string, string, string];
  startNote?: string;
  title?: string;
}

const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const MOVE_MS = 900;
const PHASE_MS = [1200, 1700, 2900, 500];
const COLORS = ["var(--arm-1)", "var(--arm-2)", "var(--arm-3)", "var(--arm-4)"] as const;
const RAIN = [5, 14, 23, 31, 40, 49, 57, 66, 74, 83, 91, 96];
const RAIN_DELAY = [0, 260, 520, 120, 400, 640, 60, 320, 580, 200, 460, 700];
const LABELS = ["Ad A", "Ad B", "Ad C", "Ad D"] as const;
const START = [25, 25, 25, 25] as const;
const END = [70, 10, 10, 10] as const;
const RATES = ["5.3%", "2.1%", "1.8%", "2.4%"] as const;
const PHASES = ["split evenly", "traffic decides", "budget follows the winner"] as const;

const CSS = `
.bs-track{position:relative;overflow:hidden;border-radius:0.5rem;background:var(--surface-2);border:1px solid var(--border-strong)}
.bs-seg{position:absolute;top:0;bottom:0;left:0;width:100%;transform-origin:left center;will-change:transform;border-radius:0.25rem}
.bs-rail{position:absolute;left:0;top:0;width:100%;height:0}
.bs-pip{position:absolute;left:0;top:0;width:0.375rem;height:0.375rem;margin:-0.1875rem 0 0 -0.1875rem;border-radius:9999px;background:var(--subtle);animation:bs-rain 1100ms linear infinite}
.bs-coin{position:absolute;left:0;top:50%;width:100%;height:0;animation:bs-glide ${MOVE_MS}ms ${EASE} both}
.bs-coin-dot{position:absolute;left:0;top:0;width:0.5rem;height:0.5rem;margin:-0.25rem 0 0 -0.25rem;border-radius:9999px;background:var(--accent);animation:bs-arc ${MOVE_MS}ms ${EASE} both}
@keyframes bs-rain{0%{transform:translate3d(0,0,0) scale(0.4);opacity:0}35%{opacity:1}75%{opacity:1}100%{transform:translate3d(0,0.9rem,0) scale(0.4);opacity:0}}
@keyframes bs-glide{from{transform:translate3d(var(--bs-x0),0,0)}to{transform:translate3d(var(--bs-x1),0,0)}}
@keyframes bs-arc{0%{transform:translate3d(0,0,0) scale(0.35);opacity:0}25%{opacity:1}50%{transform:translate3d(0,-0.85rem,0) scale(1)}100%{transform:translate3d(0,0,0) scale(0.35);opacity:0}}
`;

function subscribeMotion(notify: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function centers(shares: readonly number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const s of shares) {
    out.push(run + s / 2);
    run += s;
  }
  return out;
}

function offsets(shares: readonly number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const s of shares) {
    out.push(run);
    run += s;
  }
  return out;
}

export default function BudgetShift({
  className = "",
  budget = 100,
  labels = LABELS,
  start = START,
  end = END,
  rates = RATES,
  budgetLabel = "test budget",
  rateLabel = "CTR",
  phaseLabels = PHASES,
  startNote = "started at 25 / 25 / 25 / 25",
  title = "A hundred dollar test budget starts split evenly across four ads. Traffic arrives, one ad converts better than the rest, and the budget moves to seventy percent on the winner.",
}: BudgetShiftProps) {
  const [holder, started] = useInView<HTMLDivElement>({ threshold: 0.2, rootMargin: "0px" });
  const reduced = useSyncExternalStore(
    subscribeMotion,
    prefersReducedMotion,
    () => false,
  );
  const [phase, setPhase] = useState(0);
  const amounts = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (reduced || !started) return;
    const id = window.setTimeout(() => setPhase((p) => (p + 1) % 4), PHASE_MS[phase]);
    return () => window.clearTimeout(id);
  }, [phase, started, reduced]);

  useEffect(() => {
    const write = (values: readonly number[]) => {
      amounts.current.forEach((el, i) => {
        if (el) el.textContent = `$${Math.round((budget * values[i]) / 100)}`;
      });
    };

    if (reduced) {
      write(end);
      return;
    }
    if (phase === 0) {
      write(start);
      return;
    }
    if (phase !== 2) return;

    const t0 = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / MOVE_MS);
      const e = 1 - Math.pow(1 - k, 3);
      write(start.map((s, i) => s + (end[i] - s) * e));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, reduced, budget, start, end]);

  const moved = reduced || phase >= 2;
  const shares = moved ? end : start;
  const lefts = offsets(shares);
  const winner = end.indexOf(Math.max(...end));
  const startCenters = centers(start);
  const endCenters = centers(end);
  const showRates = reduced || phase >= 1;

  const coins = start
    .map((_, i) => i)
    .filter((i) => i !== winner)
    .flatMap((i, k) =>
      [0, 1].map((j) => ({
        id: `${i}-${j}`,
        x0: `${startCenters[i] + (j === 0 ? -3 : 3)}%`,
        x1: `${endCenters[winner] + (j === 0 ? -4 : 4)}%`,
        delay: `${k * 70 + j * 110}ms`,
      })),
    );

  return (
    <div ref={holder} className={className} role="img" aria-label={title}>
      <style>{CSS}</style>

      <div
        style={{
          opacity: !reduced && phase === 3 ? 0 : 1,
          transition: reduced ? "none" : `opacity ${phase === 3 ? 420 : 380}ms ${EASE}`,
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
            <span className="tabular-nums font-semibold text-foreground">${budget}</span>{" "}
            {budgetLabel}
          </p>
          <p className="min-w-0 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
            {reduced ? phaseLabels[2] : phaseLabels[Math.min(phase, 2)]}
          </p>
        </div>

        <div className="relative mt-2.5 h-3.5">
          {!reduced && phase === 1
            ? RAIN.map((x, i) => (
                <span
                  key={x}
                  className="bs-rail"
                  style={{ transform: `translate3d(${x}%, 0, 0)` }}
                >
                  <span className="bs-pip" style={{ animationDelay: `${RAIN_DELAY[i]}ms` }} />
                </span>
              ))
            : null}
        </div>

        <div className="bs-track h-9 sm:h-11">
          {shares.map((s, i) => (
            <span
              key={labels[i]}
              className="bs-seg"
              style={{
                background: COLORS[i],
                transform: `translateX(${lefts[i]}%) scaleX(${Math.max(s / 100 - 0.006, 0.004)})`,
                transition: reduced || phase === 0 ? "none" : `transform ${MOVE_MS}ms ${EASE}`,
              }}
            />
          ))}
          {!reduced && phase === 2
            ? coins.map((c) => (
                <span
                  key={c.id}
                  className="bs-coin"
                  style={
                    {
                      "--bs-x0": c.x0,
                      "--bs-x1": c.x1,
                      animationDelay: c.delay,
                    } as CSSProperties
                  }
                >
                  <span className="bs-coin-dot" style={{ animationDelay: c.delay }} />
                </span>
              ))
            : null}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-x-2 sm:gap-x-4">
          {labels.map((label, i) => (
            <div key={label} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    background: COLORS[i],
                    opacity: moved && i !== winner ? 0.45 : 1,
                    transition: `opacity ${MOVE_MS}ms ${EASE}`,
                  }}
                />
                <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted">
                  {label}
                </span>
              </div>
              <p className="mt-1 text-[clamp(1.125rem,4.6vw,1.625rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                <span ref={(el) => void (amounts.current[i] = el)}>
                  ${Math.round((budget * start[i]) / 100)}
                </span>
              </p>
              <p
                className="mt-1.5 min-w-0 truncate font-mono text-[0.6875rem]"
                style={{
                  opacity: showRates ? 1 : 0,
                  color: i === winner ? "var(--accent)" : "var(--muted)",
                  transition: `opacity 420ms ${EASE}`,
                }}
              >
                {rateLabel} {rates[i]}
              </p>
            </div>
          ))}
        </div>

        {reduced ? (
          <p className="mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
            {startNote}
          </p>
        ) : null}
      </div>
    </div>
  );
}
