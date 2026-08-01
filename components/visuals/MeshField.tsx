"use client";

import { useEffect, useRef } from "react";

export type MeshFieldVariant = "mesh" | "grid" | "flow" | "contour";
export type MeshFieldIntensity = "faint" | "soft" | "medium";

export interface MeshFieldProps {
  variant?: MeshFieldVariant;
  intensity?: MeshFieldIntensity;
  parallax?: boolean;
  position?: "fixed" | "absolute";
  className?: string;
}

const SPACING = 28;
const MAX_PIXELS = 1800000;
const MAX_RATIO = 1.5;

const OPACITY: Record<MeshFieldIntensity, string> = {
  faint: "0.5",
  soft: "0.78",
  medium: "1",
};

const DOT_ALPHA: Record<MeshFieldIntensity, number> = {
  faint: 0.14,
  soft: 0.2,
  medium: 0.26,
};

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export default function MeshField({
  variant = "mesh",
  intensity = "soft",
  parallax = true,
  position = "fixed",
  className = "",
}: MeshFieldProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const showGrid = variant === "mesh" || variant === "grid";
  const showFlow = variant !== "grid";

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
      if (flowRef.current) {
        flowRef.current.style.transform = `translate3d(0, ${(y * -0.1).toFixed(2)}px, 0)`;
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

  useEffect(() => {
    if (!showFlow) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

    let width = 0;
    let height = 0;
    let ratio = 1;
    let ink = "17, 17, 17";
    const base = DOT_ALPHA[intensity];

    const readInk = () => {
      const color = getComputedStyle(canvas).color;
      const parts = color.match(/\d+(\.\d+)?/g);
      if (parts && parts.length >= 3) ink = `${parts[0]}, ${parts[1]}, ${parts[2]}`;
    };

    const paint = () => {
      ctx.clearRect(0, 0, width, height);
      const cols = Math.ceil(width / SPACING) + 1;
      const rows = Math.ceil(height / SPACING) + 1;
      const size = 1.25;

      for (let cy = 0; cy < rows; cy += 1) {
        for (let cx = 0; cx < cols; cx += 1) {
          const h1 = hash(cx, cy);
          if (h1 < 0.16) continue;
          const h2 = hash(cx + 57, cy + 91);
          const h3 = hash(cx + 113, cy + 29);
          const x = cx * SPACING + (h2 - 0.5) * 3;
          const y = cy * SPACING + (h3 - 0.5) * 3;
          const alpha = base * (0.4 + h1 * 0.6);
          ctx.fillStyle = `rgba(${ink}, ${alpha.toFixed(3)})`;
          ctx.fillRect(x, y, size, size);
        }
      }
    };

    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const nextW = Math.max(1, Math.round(box.width));
      const nextH = Math.max(1, Math.round(box.height));
      if (nextW === width && nextH === height) return;
      width = nextW;
      height = nextH;
      ratio = Math.max(
        1,
        Math.min(window.devicePixelRatio || 1, MAX_RATIO, Math.sqrt(MAX_PIXELS / (width * height))),
      );
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint();
    };

    const onTheme = () => {
      readInk();
      paint();
    };

    readInk();
    measure();

    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(canvas);
    darkQuery.addEventListener("change", onTheme);

    return () => {
      resizeObserver.disconnect();
      darkQuery.removeEventListener("change", onTheme);
    };
  }, [showFlow, intensity]);

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
      {showFlow ? (
        <div
          ref={flowRef}
          className={`bd-field-layer ${parallax ? "bd-field-parallax" : ""}`}
        >
          <canvas ref={canvasRef} className="bd-field-flow" />
        </div>
      ) : null}
    </div>
  );
}
