"use client";

import { useEffect, useId, useRef, useState } from "react";

export type BanditLearningTone = "spectrum" | "accent";

export interface BanditLearningProps {
  tone?: BanditLearningTone;
  labels?: readonly [string, string, string, string];
  caption?: string;
  allocationLabel?: string;
  showAllocation?: boolean;
  loopSeconds?: number;
  title?: string;
  className?: string;
}

const LEFT = 24;
const RIGHT = 616;
const BASE = 232;
const PEAK = 58;
const CENTER = 320;
const SIGMA = 128;
const SAMPLES = 88;
const GUIDES = Array.from({ length: 9 }, (_, i) => LEFT + i * 74);

function bell(): { line: string; area: string } {
  const twoSigmaSq = 2 * SIGMA * SIGMA;
  const edge = Math.exp(-((RIGHT - CENTER) ** 2) / twoSigmaSq);
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const x = LEFT + ((RIGHT - LEFT) * i) / SAMPLES;
    const g = Math.exp(-((x - CENTER) ** 2) / twoSigmaSq);
    const h = Math.max(0, (g - edge) / (1 - edge)) * PEAK;
    points.push(`${x.toFixed(2)} ${(BASE - h).toFixed(2)}`);
  }
  const line = `M${points.join(" L")}`;
  const area = `${line} L${RIGHT} ${BASE} L${LEFT} ${BASE} Z`;
  return { line, area };
}

const CURVE = bell();

const SPECTRUM = ["var(--arm-1)", "var(--arm-2)", "var(--arm-3)", "var(--arm-4)"] as const;
const ACCENT = ["var(--subtle)", "var(--subtle)", "var(--accent)", "var(--subtle)"] as const;

const DEFAULT_LABELS = ["A", "B", "C", "D"] as const;

export default function BanditLearning({
  tone = "spectrum",
  labels = DEFAULT_LABELS,
  caption = "belief per creative",
  allocationLabel = "traffic share",
  showAllocation = true,
  loopSeconds = 11,
  title = "Four ad creatives start equal, then the winner takes the traffic",
  className = "",
}: BanditLearningProps) {
  const id = useId();
  const clipId = `bd-bar-${id.replace(/:/g, "")}`;
  const colors = tone === "accent" ? ACCENT : SPECTRUM;
  const mono = "var(--font-geist-mono), ui-monospace, monospace";

  const holder = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setCompact(entry.contentRect.width < 520);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const capSize = compact ? 17 : 11;
  const capSpace = compact ? 2.2 : 1.5;
  const letterSize = compact ? 20 : 13;
  const letterY = compact ? 258 : 252;
  const barY = compact ? 272 : 262;
  const barH = compact ? 18 : 14;
  const boxH = compact ? 326 : 304;
  const bottomY = compact ? 316 : 294;

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
          <clipPath id={clipId}>
            <rect x={LEFT} y={barY} width={RIGHT - LEFT} height={barH} rx={4} />
          </clipPath>
        </defs>

        <g stroke="var(--grid-line)" strokeWidth="1" vectorEffect="non-scaling-stroke">
          {GUIDES.map((x) => (
            <line key={x} x1={x} y1={38} x2={x} y2={BASE} />
          ))}
        </g>

        {caption ? (
          <text
            x={LEFT}
            y={20}
            fill="var(--subtle)"
            fontFamily={mono}
            fontSize={capSize}
            letterSpacing={capSpace}
          >
            {caption.toUpperCase()}
          </text>
        ) : null}

        {colors.map((color, i) => (
          <g key={`arm-${labels[i]}`} className={`bd-arm bd-arm-${i + 1}`} style={{ color }}>
            <path d={CURVE.area} fill="currentColor" fillOpacity={0.14} />
            <path
              d={CURVE.line}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        <g stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke">
          <line x1={LEFT} y1={BASE} x2={RIGHT} y2={BASE} />
          {GUIDES.map((x) => (
            <line key={x} x1={x} y1={BASE} x2={x} y2={BASE + 5} />
          ))}
        </g>

        {colors.map((color, i) => (
          <g key={`mean-${labels[i]}`} className={`bd-mean-${i + 1}`} style={{ color }}>
            <text
              x={CENTER}
              y={letterY}
              fill="currentColor"
              fontFamily={mono}
              fontSize={letterSize}
              fontWeight={500}
              textAnchor="middle"
            >
              {labels[i]}
            </text>
          </g>
        ))}

        {showAllocation ? (
          <>
            <g clipPath={`url(#${clipId})`}>
              <rect x={LEFT} y={barY} width={RIGHT - LEFT} height={barH} fill="var(--surface-2)" />
              {colors.map((color, i) => (
                <rect
                  key={`share-${labels[i]}`}
                  className={`bd-share bd-share-${i + 1}`}
                  x={LEFT}
                  y={barY}
                  width={RIGHT - LEFT}
                  height={barH}
                  fill={color}
                  fillOpacity={0.88}
                />
              ))}
            </g>
            <rect
              x={LEFT}
              y={barY}
              width={RIGHT - LEFT}
              height={barH}
              rx={4}
              fill="none"
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {allocationLabel ? (
              <text
                x={LEFT}
                y={bottomY}
                fill="var(--subtle)"
                fontFamily={mono}
                fontSize={capSize}
                letterSpacing={capSpace}
              >
                {allocationLabel.toUpperCase()}
              </text>
            ) : null}
          </>
        ) : null}
      </svg>
    </div>
  );
}
