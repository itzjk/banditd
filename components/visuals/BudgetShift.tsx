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

const EASE = "cubic-bezier(0.32, 0, 0.18, 1)";
const MOVE_MS = 1600;
const PHASE_MS = [2600, 3000, 4200, 700] as const;
const FADE_MS = 520;
const COLORS = ["var(--curve-1)", "var(--curve-2)", "var(--curve-3)", "var(--curve-4)"] as const;
const LABELS = ["Ad A", "Ad B", "Ad C", "Ad D"] as const;
const START = [25, 25, 25, 25] as const;
const END = [70, 10, 10, 10] as const;
const RATES = ["5.3%", "2.1%", "1.8%", "2.4%"] as const;
const PHASES = ["Explore", "Evidence", "Concentrate"] as const;
const INK = "#e9edf0";
const MUT = "#9aa3ab";
const GRN = "#3fe08f";
const CANVAS = "#0b0d10";
const LINE = "rgba(255,255,255,0.1)";
const TRACK = "rgba(255,255,255,0.08)";

const CSS = `
.bsx-fill{position:absolute;inset:0;transform-origin:left center;will-change:transform;border-radius:9999px}
.bsx-seg{position:absolute;inset:0;transform-origin:left center;background:${INK}}
@keyframes bsx-run{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes bsx-dot{0%,100%{opacity:1}50%{opacity:0.3}}
`;

function subscribeMotion(notify: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
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
  startNote = "Started at an even 25 / 25 / 25 / 25 split. Traffic showed one ad converting ahead of the rest, so 70% of spend settled on the winner.",
  title = "A hundred dollar test budget starts split evenly across four ads. Traffic arrives, one ad converts better than the rest, and the allocation concentrates seventy percent of spend on the winner.",
}: BudgetShiftProps) {
  const [holder, started] = useInView<HTMLDivElement>({ threshold: 0.2, rootMargin: "0px" });
  const reduced = useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false);
  const [phase, setPhase] = useState(0);
  const [cycle, setCycle] = useState(0);
  const amountEls = useRef<(HTMLSpanElement | null)[]>([]);
  const shareEls = useRef<(HTMLSpanElement | null)[]>([]);
  const bigEl = useRef<HTMLSpanElement | null>(null);

  const winner = end.indexOf(Math.max(...end));

  useEffect(() => {
    if (reduced || !started) return;
    const id = window.setTimeout(() => {
      if (phase === 3) {
        setCycle((c) => c + 1);
        setPhase(0);
      } else {
        setPhase(phase + 1);
      }
    }, PHASE_MS[phase]);
    return () => window.clearTimeout(id);
  }, [phase, started, reduced]);

  useEffect(() => {
    const write = (values: readonly number[]) => {
      values.forEach((v, i) => {
        const a = amountEls.current[i];
        if (a) a.textContent = `$${((budget * v) / 100).toFixed(2)}`;
        const s = shareEls.current[i];
        if (s) s.textContent = `${v.toFixed(1)}%`;
      });
      if (bigEl.current) bigEl.current.textContent = `${values[winner].toFixed(1)}%`;
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
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      write(start.map((s, i) => s + (end[i] - s) * e));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, reduced, budget, start, end, winner]);

  const moved = reduced || phase >= 2;
  const shares = moved ? end : start;
  const showRates = reduced || phase >= 1;
  const activePhase = reduced ? 2 : Math.min(phase, 2);
  const faded = !reduced && phase === 3;
  const delta = end[winner] - start[winner];

  const segStyle = (i: number): CSSProperties => {
    if (reduced || phase === 3 || i < phase) return { transform: "scaleX(1)" };
    if (i === phase) return { transform: "scaleX(0)", animation: `bsx-run ${PHASE_MS[i]}ms linear both` };
    return { transform: "scaleX(0)" };
  };

  return (
    <div ref={holder} className={className} role="img" aria-label={title}>
      <style>{CSS}</style>

      <div
        className="rounded-[0.625rem] px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5"
        style={{ background: CANVAS, border: `1px solid ${LINE}` }}
      >
        <div
          className="flex items-center justify-between gap-4 border-b pb-3"
          style={{ borderColor: LINE }}
        >
          <p
            className="flex min-w-0 items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.16em]"
            style={{ color: MUT }}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background: GRN,
                animation: reduced ? "none" : "bsx-dot 2.8s ease-in-out infinite",
              }}
            />
            Live allocation
          </p>
          <p
            className="min-w-0 truncate font-mono text-[0.625rem] uppercase tracking-[0.16em]"
            style={{ color: MUT }}
          >
            {reduced ? "Settled" : "Running"}
          </p>
        </div>

        <div
          style={{
            opacity: faded ? 0 : 1,
            transition: reduced ? "none" : `opacity ${faded ? FADE_MS : 420}ms ${EASE}`,
          }}
        >
          <div className="mt-4 grid grid-cols-3 gap-1.5 sm:gap-3">
            {phaseLabels.map((p, i) => (
              <div key={p} className="min-w-0">
                <div
                  className="relative h-0.5 overflow-hidden rounded-full"
                  style={{ background: TRACK }}
                >
                  <span key={`${cycle}-${i}`} className="bsx-seg" style={segStyle(i)} />
                </div>
                <p
                  className="mt-1.5 break-words font-mono text-[0.5625rem] uppercase leading-snug tracking-[0.06em] sm:truncate sm:text-[0.625rem] sm:tracking-[0.14em]"
                  style={{ color: i === activePhase ? INK : MUT }}
                >
                  {`0${i + 1}`} {p}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3.5">
            {labels.map((label, i) => (
              <div key={label} className="min-w-0">
                <div className="flex items-baseline gap-1.5 sm:gap-2">
                  <span
                    className="size-1.5 shrink-0 self-center rounded-[1px]"
                    style={{
                      background: COLORS[i],
                      opacity: moved && i !== winner ? 0.5 : 1,
                      transition: `opacity ${MOVE_MS}ms ${EASE}`,
                    }}
                  />
                  <span
                    className="min-w-0 truncate font-mono text-[0.625rem] uppercase tracking-[0.12em]"
                    style={{ color: MUT }}
                  >
                    {label}
                  </span>
                  <span
                    className="shrink-0 font-mono text-[0.625rem] tabular-nums"
                    style={{
                      color: i === winner ? GRN : MUT,
                      opacity: showRates ? 1 : 0,
                      transition: `opacity 600ms ${EASE}`,
                    }}
                  >
                    {rateLabel} {rates[i]}
                  </span>
                  <span className="min-w-0 flex-1" />
                  <span
                    ref={(el) => void (amountEls.current[i] = el)}
                    className="shrink-0 font-mono text-[0.8125rem] font-medium tabular-nums"
                    style={{ color: INK }}
                  >
                    ${((budget * start[i]) / 100).toFixed(2)}
                  </span>
                  <span
                    ref={(el) => void (shareEls.current[i] = el)}
                    className="w-9 shrink-0 text-right font-mono text-[0.625rem] tabular-nums sm:w-11"
                    style={{ color: MUT }}
                  >
                    {start[i].toFixed(1)}%
                  </span>
                </div>
                <div
                  className="relative mt-1.5 h-1.5 overflow-hidden rounded-full"
                  style={{ background: TRACK }}
                >
                  <span
                    className="bsx-fill"
                    style={{
                      background: COLORS[i],
                      opacity: moved && i !== winner ? 0.45 : 1,
                      transform: `scaleX(${Math.max(shares[i] / 100, 0.005)})`,
                      transition:
                        reduced || phase === 0
                          ? "none"
                          : `transform ${MOVE_MS}ms ${EASE}, opacity ${MOVE_MS}ms ${EASE}`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div
            className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-t pt-4"
            style={{ borderColor: LINE }}
          >
            <div className="min-w-0">
              <p
                className="font-mono text-[0.625rem] uppercase tracking-[0.16em]"
                style={{ color: MUT }}
              >
                Winner share
              </p>
              <p className="mt-1.5 flex items-baseline gap-2">
                <span
                  ref={bigEl}
                  className="font-mono text-[1.5rem] font-medium leading-none tracking-[-0.02em] tabular-nums sm:text-[1.75rem]"
                  style={{ color: INK }}
                >
                  {start[winner].toFixed(1)}%
                </span>
                <span
                  className="font-mono text-[0.6875rem] tabular-nums"
                  style={{
                    color: GRN,
                    opacity: moved ? 1 : 0,
                    transition: `opacity 600ms ${EASE}`,
                  }}
                >
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)} pts
                </span>
              </p>
            </div>
            <div className="min-w-0 text-right">
              <p
                className="font-mono text-[0.625rem] uppercase tracking-[0.16em]"
                style={{ color: MUT }}
              >
                {budgetLabel}
              </p>
              <p
                className="mt-1.5 font-mono text-[0.9375rem] leading-none tabular-nums"
                style={{ color: INK }}
              >
                ${budget.toFixed(2)}
              </p>
            </div>
          </div>

          {reduced ? (
            <p
              className="mt-3.5 font-mono text-[0.625rem] leading-relaxed"
              style={{ color: MUT }}
            >
              {startNote}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
