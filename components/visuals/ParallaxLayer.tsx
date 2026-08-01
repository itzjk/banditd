"use client";

import { useEffect, useRef, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { prefersReducedMotion } from "./useInView";

export interface ParallaxLayerProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: ElementType;
  speed?: number;
  max?: number;
  className?: string;
}

export default function ParallaxLayer({
  children,
  as,
  speed = 0.06,
  max = 44,
  className = "",
  ...rest
}: ParallaxLayerProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const middle = rect.top + rect.height / 2 - window.innerHeight / 2;
      const shift = Math.max(-max, Math.min(max, -middle * speed));
      el.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [speed, max]);

  const Tag: ElementType = as ?? "div";

  return (
    <Tag {...rest} ref={ref} className={`bd-parallax ${className}`.trim()}>
      {children}
    </Tag>
  );
}
