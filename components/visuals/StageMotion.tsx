"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/components/visuals";

interface Mote {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  a: number;
  tw: number;
}

interface Drop {
  x: number;
  y: number;
  r: number;
  vy: number;
  life: number;
  span: number;
}

export default function StageMotion() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (prefersReducedMotion()) return;

    const c2d = canvas.getContext("2d");
    if (!c2d) return;
    const ctx: CanvasRenderingContext2D = c2d;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let motes: Mote[] = [];
    let drops: Drop[] = [];
    let frame = 0;
    let running = true;

    function seed() {
      const count = Math.round((width * height) / 26000);
      motes = Array.from({ length: Math.min(160, Math.max(40, count)) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.5 + Math.random() * 1.3,
        vy: -(0.05 + Math.random() * 0.16),
        vx: (Math.random() - 0.5) * 0.05,
        a: 0.14 + Math.random() * 0.4,
        tw: Math.random() * Math.PI * 2,
      }));
      drops = [];
    }

    function resize() {
      const node = ref.current;
      if (!node) return;
      const parent = node.parentElement;
      if (!parent) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = parent.clientWidth;
      height = parent.clientHeight;
      node.width = Math.round(width * dpr);
      node.height = Math.round(height * dpr);
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function spawnDrop() {
      if (width < 900) return;
      const originX = width * (0.70 + Math.random() * 0.16);
      const originY = height * (0.34 + Math.random() * 0.12);
      drops.push({
        x: originX,
        y: originY,
        r: 1 + Math.random() * 2.2,
        vy: 0.5 + Math.random() * 0.9,
        life: 0,
        span: 90 + Math.random() * 70,
      });
    }

    function draw() {
      if (!running) return;
      ctx.clearRect(0, 0, width, height);

      for (const m of motes) {
        m.y += m.vy;
        m.x += m.vx;
        m.tw += 0.012;
        if (m.y < -4) {
          m.y = height + 4;
          m.x = Math.random() * width;
        }
        const alpha = m.a * (0.62 + 0.38 * Math.sin(m.tw));
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(168, 205, 224, ${alpha.toFixed(3)})`;
        ctx.fill();
      }

      frame += 1;
      if (frame % 26 === 0) spawnDrop();

      drops = drops.filter((d) => d.life < d.span);
      for (const d of drops) {
        d.life += 1;
        d.vy += 0.012;
        d.y += d.vy;
        d.x += Math.sin(d.life / 18) * 0.22;
        const t = d.life / d.span;
        const alpha = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(214, 168, 118, ${(alpha * 0.55).toFixed(3)})`;
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }

    resize();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    requestAnimationFrame(draw);

    return () => {
      running = false;
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="bd-stage-motion" />;
}
