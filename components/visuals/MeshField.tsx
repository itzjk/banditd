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

const LANES = 4;
const CYCLE_MS = 24000;
const SHARE_FROM = [0.25, 0.25, 0.25, 0.25];
const SHARE_TO = [0.1, 0.14, 0.64, 0.12];
const BAND_TOP = 0.08;
const BAND_HEIGHT = 0.84;
const MAX_STEP_MS = 48;
const MAX_PIXELS = 1800000;
const MAX_RATIO = 1.5;

const OPACITY: Record<MeshFieldIntensity, string> = {
  faint: "0.5",
  soft: "0.78",
  medium: "1",
};

const DOT_ALPHA: Record<MeshFieldIntensity, number> = {
  faint: 0.2,
  soft: 0.3,
  medium: 0.4,
};

const GUIDE_ALPHA: Record<MeshFieldIntensity, number> = {
  faint: 0.1,
  soft: 0.16,
  medium: 0.22,
};

function easeShare(t: number): number {
  return t * t * (3 - 2 * t);
}

function pickLane(weights: number[]): number {
  let r = Math.random();
  for (let i = 0; i < LANES; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return LANES - 1;
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
    const host = flowRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

    let width = 0;
    let height = 0;
    let ratio = 1;
    let count = 0;
    let ink = "17, 17, 17";
    let raf = 0;
    let last = 0;
    let clock = 0;
    let visible = true;
    let running = false;

    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let pv = new Float32Array(0);
    let pw = new Float32Array(0);
    let ph = new Float32Array(0);
    let pl = new Uint8Array(0);

    const weights = [0.25, 0.25, 0.25, 0.25];
    const dot = DOT_ALPHA[intensity];
    const guide = GUIDE_ALPHA[intensity];

    const laneY = (lane: number) => (BAND_TOP + (BAND_HEIGHT * (lane + 0.5)) / LANES) * height;
    const laneGap = () => (BAND_HEIGHT * height) / LANES;

    const readInk = () => {
      const color = getComputedStyle(canvas).color;
      const parts = color.match(/\d+(\.\d+)?/g);
      if (parts && parts.length >= 3) ink = `${parts[0]}, ${parts[1]}, ${parts[2]}`;
    };

    const seed = (index: number, spread: boolean) => {
      const lane = pickLane(weights);
      pl[index] = lane;
      px[index] = spread ? Math.random() * width : -Math.random() * width * 0.35;
      py[index] = laneY(lane) + (Math.random() - 0.5) * laneGap() * 0.44;
      pv[index] = 18 + Math.random() * 26;
      pw[index] = 5 + Math.random() * 10;
      ph[index] = Math.random() < 0.3 ? 1.6 : 1.1;
    };

    const setShare = (progress: number) => {
      const e = easeShare(progress);
      for (let i = 0; i < LANES; i += 1) {
        weights[i] = SHARE_FROM[i] + (SHARE_TO[i] - SHARE_FROM[i]) * e;
      }
    };

    const paint = () => {
      ctx.clearRect(0, 0, width, height);
      const gap = laneGap();

      for (let lane = 0; lane < LANES; lane += 1) {
        const y = Math.round((laneY(lane) + gap * 0.42) * ratio) / ratio;
        ctx.fillStyle = `rgba(${ink}, ${(guide * (0.6 + weights[lane] * 2.2)).toFixed(3)})`;
        ctx.fillRect(0, y, width, 1 / ratio);
      }

      for (let lane = 0; lane < LANES; lane += 1) {
        const alpha = Math.min(1, dot * (0.6 + weights[lane] * 1.7));
        ctx.fillStyle = `rgba(${ink}, ${alpha.toFixed(3)})`;
        for (let i = 0; i < count; i += 1) {
          if (pl[i] !== lane) continue;
          ctx.fillRect(px[i] - pw[i], py[i], pw[i], ph[i]);
        }
      }
    };

    const step = (now: number) => {
      raf = 0;
      const delta = Math.min(now - last, MAX_STEP_MS);
      last = now;
      clock += delta;

      const phase = (clock % (CYCLE_MS * 2)) / CYCLE_MS;
      setShare(phase > 1 ? 2 - phase : phase);

      for (let i = 0; i < count; i += 1) {
        px[i] += (pv[i] * delta) / 1000;
        if (px[i] - pw[i] > width) {
          seed(i, false);
          px[i] = -pw[i];
        }
      }

      paint();
      if (running) raf = requestAnimationFrame(step);
    };

    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const start = () => {
      if (running || reduceQuery.matches || !visible || document.hidden) return;
      if (!width || !height) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };

    const rest = () => {
      setShare(1);
      for (let i = 0; i < count; i += 1) seed(i, true);
      paint();
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

      const target = Math.round(Math.min(190, Math.max(34, (width * height) / 4200)));
      if (target !== count) {
        count = target;
        px = new Float32Array(count);
        py = new Float32Array(count);
        pv = new Float32Array(count);
        pw = new Float32Array(count);
        ph = new Float32Array(count);
        pl = new Uint8Array(count);
      }
      for (let i = 0; i < count; i += 1) seed(i, true);
      if (reduceQuery.matches) rest();
      else paint();
    };

    const onMotion = () => {
      stop();
      if (reduceQuery.matches) rest();
      else start();
    };

    const onTheme = () => {
      readInk();
      paint();
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    readInk();
    measure();

    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(canvas);

    let intersectionObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) visible = entry.isIntersecting;
          if (visible) start();
          else stop();
        },
        { rootMargin: "120px" },
      );
      intersectionObserver.observe(host);
    }

    reduceQuery.addEventListener("change", onMotion);
    darkQuery.addEventListener("change", onTheme);
    document.addEventListener("visibilitychange", onVisibility);
    if (reduceQuery.matches) rest();
    else start();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      reduceQuery.removeEventListener("change", onMotion);
      darkQuery.removeEventListener("change", onTheme);
      document.removeEventListener("visibilitychange", onVisibility);
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
