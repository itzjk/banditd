"use client";

import { useEffect, useRef } from "react";

export type MeshFieldVariant = "mesh" | "grid" | "contour";
export type MeshFieldIntensity = "faint" | "soft" | "medium";

export interface MeshFieldProps {
  variant?: MeshFieldVariant;
  intensity?: MeshFieldIntensity;
  parallax?: boolean;
  position?: "fixed" | "absolute";
  className?: string;
}

const VW = 1440;
const VH = 900;
const STEPS = 72;
const LINES = 9;

function contourPath(index: number): string {
  const base = 96 + index * 84;
  const amp = 22 + (index % 3) * 13;
  const freq = 1.05 + index * 0.14;
  const phase = index * 0.82;
  let d = "";
  for (let i = 0; i <= STEPS; i += 1) {
    const ratio = i / STEPS;
    const x = ratio * VW;
    const t = ratio * Math.PI * 2 * freq + phase;
    const y = base + Math.sin(t) * amp + Math.sin(t * 0.5 + phase) * amp * 0.42;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    if (i < STEPS) d += " ";
  }
  return d;
}

const CONTOURS = Array.from({ length: LINES }, (_, i) => contourPath(i));

const AXIS_Y = 430;
const TICKS = Array.from({ length: 37 }, (_, i) => i * 40);

const OPACITY: Record<MeshFieldIntensity, string> = {
  faint: "0.5",
  soft: "0.78",
  medium: "1",
};

const LINE_OPACITY: Record<MeshFieldIntensity, number> = {
  faint: 0.05,
  soft: 0.075,
  medium: 0.11,
};

export default function MeshField({
  variant = "mesh",
  intensity = "soft",
  parallax = true,
  position = "fixed",
  className = "",
}: MeshFieldProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const linesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!parallax) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const y = window.scrollY;
      if (gridRef.current) {
        gridRef.current.style.transform = `translate3d(0, ${(y * -0.045).toFixed(2)}px, 0)`;
      }
      if (linesRef.current) {
        linesRef.current.style.transform = `translate3d(0, ${(y * -0.1).toFixed(2)}px, 0)`;
      }
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [parallax]);

  const showGrid = variant !== "contour";
  const showLines = variant !== "grid";
  const stroke = LINE_OPACITY[intensity];

  return (
    <div
      aria-hidden="true"
      className={`bd-field ${position === "absolute" ? "bd-field-absolute" : ""} ${className}`}
      style={{ ["--bd-field-opacity" as string]: OPACITY[intensity] }}
    >
      {showGrid ? (
        <div
          ref={gridRef}
          className={`bd-field-layer bd-field-grid ${parallax ? "bd-field-parallax" : ""}`}
        />
      ) : null}
      {showLines ? (
        <div
          ref={linesRef}
          className={`bd-field-layer ${parallax ? "bd-field-parallax" : ""}`}
        >
          <svg
            className="bd-field-lines bd-drift"
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="xMidYMid slice"
            focusable="false"
          >
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              opacity={stroke}
            >
              {CONTOURS.map((d, i) => (
                <path key={d.slice(0, 12) + i} d={d} />
              ))}
            </g>
            <g stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity={stroke * 1.3}>
              <line x1={0} y1={AXIS_Y} x2={VW} y2={AXIS_Y} />
              {TICKS.map((x) => (
                <line
                  key={x}
                  x1={x}
                  y1={AXIS_Y}
                  x2={x}
                  y2={AXIS_Y + (x % 200 === 0 ? 11 : 5)}
                />
              ))}
            </g>
          </svg>
        </div>
      ) : null}
    </div>
  );
}
