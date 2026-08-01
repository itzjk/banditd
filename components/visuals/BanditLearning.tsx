"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type BanditLearningTone = "spectrum" | "accent";

export interface BanditLearningProps {
  tone?: BanditLearningTone;
  labels?: readonly [string, string, string, string];
  caption?: string;
  allocationLabel?: string;
  rateLabel?: string;
  densityLabel?: string;
  cycleLabels?: readonly [string, string];
  showAllocation?: boolean;
  showCycle?: boolean;
  loopSeconds?: number;
  title?: string;
  className?: string;
}

const PLOT_L = 44;
const PLOT_R = 616;
const PLOT_W = 572;
const CENTER = 330;
const SIGMA = 126;
const PEAK = 52;
const PLOT_H = 188;
const SAMPLES = 88;
const ROWS = 4;
const RATE_TICKS = [0, 1, 2, 3, 4, 5];
const SHARE_TICKS = [0, 25, 50, 75, 100];
const LETTER_SHIFT = [-33, -11, 11, 33];

const SPECTRUM = ["var(--arm-1)", "var(--arm-2)", "var(--arm-3)", "var(--arm-4)"] as const;
const ACCENT = ["var(--subtle)", "var(--subtle)", "var(--accent)", "var(--subtle)"] as const;

const DEFAULT_LABELS = ["A", "B", "C", "D"] as const;
const DEFAULT_CYCLE = ["explore", "exploit"] as const;

function bell(base: number): { line: string; area: string } {
  const twoSigmaSq = 2 * SIGMA * SIGMA;
  const edge = Math.exp(-((PLOT_R - CENTER) ** 2) / twoSigmaSq);
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const x = PLOT_L + (PLOT_W * i) / SAMPLES;
    const g = Math.exp(-((x - CENTER) ** 2) / twoSigmaSq);
    const h = Math.max(0, (g - edge) / (1 - edge)) * PEAK;
    points.push(`${x.toFixed(2)} ${(base - h).toFixed(2)}`);
  }
  const line = `M${points.join(" L")}`;
  const area = `${line} L${PLOT_R} ${base} L${PLOT_L} ${base} Z`;
  return { line, area };
}

function metrics(width: number) {
  const u = 640 / Math.min(Math.max(width, 260), 900);
  const capSize = 11 * u;
  const tickSize = 10 * u;
  const titleSize = 9.5 * u;
  const letterSize = 13 * u;
  const capY = capSize;
  const plotT = capY + 16 * u;
  const base = plotT + PLOT_H;
  const letterY = base + 5 * u + letterSize;
  const rateLabelY = letterY + 6 * u + tickSize;
  const rateTitleY = rateLabelY + 8 * u + titleSize;
  const barCapY = rateTitleY + 18 * u + capSize;
  const barY = barCapY + 8 * u;
  const barH = 16 * u;
  const shareLabelY = barY + barH + 6 * u + tickSize;
  const cycleY = shareLabelY + 16 * u;
  const cycleLabelY = cycleY + 6 * u + titleSize;
  return {
    u,
    capSize,
    tickSize,
    titleSize,
    letterSize,
    capSpace: 1.4 * u,
    capY,
    plotT,
    base,
    letterY,
    rateLabelY,
    rateTitleY,
    barCapY,
    barY,
    barH,
    shareLabelY,
    cycleY,
    cycleLabelY,
  };
}

function anchorFor(index: number, length: number): "start" | "middle" | "end" {
  if (index === 0) return "start";
  if (index === length - 1) return "end";
  return "middle";
}

export default function BanditLearning({
  tone = "spectrum",
  labels = DEFAULT_LABELS,
  caption = "belief per creative",
  allocationLabel = "traffic share",
  rateLabel = "conversion rate",
  densityLabel = "density",
  cycleLabels = DEFAULT_CYCLE,
  showAllocation = true,
  showCycle = true,
  loopSeconds = 11,
  title = "Four ad creatives start from the same belief, the evidence separates them, and the traffic moves to the leader",
  className = "",
}: BanditLearningProps) {
  const id = useId();
  const key = id.replace(/:/g, "");
  const barClip = `bd-bar-${key}`;
  const plotClip = `bd-plot-${key}`;
  const colors = tone === "accent" ? ACCENT : SPECTRUM;
  const mono = "var(--font-mono-face), ui-monospace, monospace";

  const holder = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(520);

  useEffect(() => {
    const el = holder.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(Math.round(entry.contentRect.width / 4) * 4);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const m = useMemo(() => metrics(width), [width]);
  const curve = useMemo(() => bell(m.base), [m.base]);
  const rows = useMemo(
    () => Array.from({ length: ROWS }, (_, i) => m.base - (i * PLOT_H) / ROWS),
    [m.base],
  );

  const boxH = showCycle ? m.cycleLabelY + 6 * m.u : m.shareLabelY + 8 * m.u;
  const origin = `${CENTER}px ${m.base}px`;
  const midY = m.plotT + PLOT_H / 2;
  const axisX = 21;

  return (
    <div ref={holder} className={className}>
      <svg
        viewBox={`0 0 640 ${boxH}`}
        className="w-full h-auto"
        role="img"
        aria-label={title}
        style={{ ["--bd-loop" as string]: `${loopSeconds}s` }}
      >
        <defs>
          <clipPath id={barClip}>
            <rect x={PLOT_L} y={m.barY} width={PLOT_W} height={m.barH} rx={4} />
          </clipPath>
          <clipPath id={plotClip}>
            <rect x={PLOT_L} y={0} width={PLOT_W} height={m.base} />
          </clipPath>
        </defs>

        {caption ? (
          <text
            x={PLOT_L}
            y={m.capY}
            fill="var(--muted)"
            fontFamily={mono}
            fontSize={m.capSize}
            letterSpacing={m.capSpace}
          >
            {caption.toUpperCase()}
          </text>
        ) : null}

        <g stroke="var(--grid-line)" strokeWidth="1" vectorEffect="non-scaling-stroke">
          {rows.map((y) => (
            <line key={`row-${y}`} x1={PLOT_L} y1={y} x2={PLOT_R} y2={y} />
          ))}
          {RATE_TICKS.map((t) => (
            <line
              key={`col-${t}`}
              x1={PLOT_L + (PLOT_W * t) / 5}
              y1={m.plotT}
              x2={PLOT_L + (PLOT_W * t) / 5}
              y2={m.base}
            />
          ))}
        </g>

        <g clipPath={`url(#${plotClip})`}>
          <g className="bd-lead">
            <line
              x1={CENTER}
              y1={m.plotT}
              x2={CENTER}
              y2={m.base}
              stroke={colors[2]}
              strokeWidth="1"
              strokeDasharray={`${3 * m.u} ${4 * m.u}`}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          {colors.map((color, i) => (
            <g
              key={`arm-${labels[i]}`}
              className={`bd-arm bd-arm-${i + 1}`}
              style={{ color, transformOrigin: origin }}
            >
              <path d={curve.area} fill="currentColor" fillOpacity={0.16} />
              <path
                d={curve.line}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </g>

        <g stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke">
          <line x1={PLOT_L} y1={m.base} x2={PLOT_R} y2={m.base} />
          <line x1={PLOT_L} y1={m.plotT} x2={PLOT_L} y2={m.base} />
          {RATE_TICKS.map((t) => (
            <line
              key={`tick-${t}`}
              x1={PLOT_L + (PLOT_W * t) / 5}
              y1={m.base}
              x2={PLOT_L + (PLOT_W * t) / 5}
              y2={m.base + 5 * m.u}
            />
          ))}
          {rows.map((y) => (
            <line key={`ytick-${y}`} x1={PLOT_L - 4 * m.u} y1={y} x2={PLOT_L} y2={y} />
          ))}
        </g>

        {densityLabel ? (
          <text
            x={axisX}
            y={midY}
            fill="var(--muted)"
            fontFamily={mono}
            fontSize={m.titleSize}
            letterSpacing={m.capSpace}
            textAnchor="middle"
            transform={`rotate(-90 ${axisX} ${midY})`}
          >
            {densityLabel.toUpperCase()}
          </text>
        ) : null}

        {colors.map((color, i) => (
          <g key={`mean-${labels[i]}`} className={`bd-mean-${i + 1}`}>
            <text
              x={CENTER + LETTER_SHIFT[i]}
              y={m.letterY}
              fill={color}
              fontFamily={mono}
              fontSize={m.letterSize}
              fontWeight={600}
              textAnchor="middle"
            >
              {labels[i]}
            </text>
          </g>
        ))}

        <g fill="var(--muted)" fontFamily={mono} fontSize={m.tickSize}>
          {RATE_TICKS.map((t, i) => (
            <text
              key={`rl-${t}`}
              x={PLOT_L + (PLOT_W * t) / 5}
              y={m.rateLabelY}
              textAnchor={anchorFor(i, RATE_TICKS.length)}
            >
              {t}%
            </text>
          ))}
        </g>

        {rateLabel ? (
          <text
            x={PLOT_L}
            y={m.rateTitleY}
            fill="var(--muted)"
            fontFamily={mono}
            fontSize={m.titleSize}
            letterSpacing={m.capSpace}
          >
            {rateLabel.toUpperCase()}
          </text>
        ) : null}

        {showAllocation ? (
          <>
            {allocationLabel ? (
              <text
                x={PLOT_L}
                y={m.barCapY}
                fill="var(--muted)"
                fontFamily={mono}
                fontSize={m.capSize}
                letterSpacing={m.capSpace}
              >
                {allocationLabel.toUpperCase()}
              </text>
            ) : null}

            <g clipPath={`url(#${barClip})`}>
              <rect x={PLOT_L} y={m.barY} width={PLOT_W} height={m.barH} fill="var(--surface-2)" />
              {colors.map((color, i) => (
                <rect
                  key={`share-${labels[i]}`}
                  className={`bd-share bd-share-${i + 1}`}
                  x={PLOT_L}
                  y={m.barY}
                  width={PLOT_W}
                  height={m.barH}
                  fill={color}
                  stroke="var(--surface-raised)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
            <rect
              x={PLOT_L}
              y={m.barY}
              width={PLOT_W}
              height={m.barH}
              rx={4}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />

            <g stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke">
              {SHARE_TICKS.map((t) => (
                <line
                  key={`st-${t}`}
                  x1={PLOT_L + (PLOT_W * t) / 100}
                  y1={m.barY + m.barH}
                  x2={PLOT_L + (PLOT_W * t) / 100}
                  y2={m.barY + m.barH + 5 * m.u}
                />
              ))}
            </g>

            <g fill="var(--muted)" fontFamily={mono} fontSize={m.tickSize}>
              {SHARE_TICKS.map((t, i) => (
                <text
                  key={`sl-${t}`}
                  x={PLOT_L + (PLOT_W * t) / 100}
                  y={m.shareLabelY}
                  textAnchor={anchorFor(i, SHARE_TICKS.length)}
                >
                  {t}%
                </text>
              ))}
            </g>
          </>
        ) : null}

        {showCycle ? (
          <>
            <line
              x1={PLOT_L}
              y1={m.cycleY}
              x2={PLOT_R}
              y2={m.cycleY}
              stroke="var(--border-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <rect
              className="bd-cycle"
              x={PLOT_L}
              y={m.cycleY - 4 * m.u}
              width={2 * m.u}
              height={9 * m.u}
              fill="var(--muted)"
            />
            <text
              x={PLOT_L}
              y={m.cycleLabelY}
              fill="var(--muted)"
              fontFamily={mono}
              fontSize={m.titleSize}
              letterSpacing={m.capSpace}
            >
              {cycleLabels[0].toUpperCase()}
            </text>
            <text
              x={PLOT_R}
              y={m.cycleLabelY}
              fill="var(--muted)"
              fontFamily={mono}
              fontSize={m.titleSize}
              letterSpacing={m.capSpace}
              textAnchor="end"
            >
              {cycleLabels[1].toUpperCase()}
            </text>
          </>
        ) : null}
      </svg>
    </div>
  );
}
