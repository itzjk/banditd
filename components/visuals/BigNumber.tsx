"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { prefersReducedMotion, useInView } from "./useInView";

export interface BigNumberProps {
  value: number | string;
  label: ReactNode;
  as?: ElementType;
  detail?: ReactNode;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  countUp?: boolean;
  duration?: number;
  align?: "start" | "center";
  tone?: "default" | "accent";
  className?: string;
}

export default function BigNumber({
  value,
  label,
  as,
  detail,
  prefix,
  suffix,
  decimals = 0,
  countUp = true,
  duration = 900,
  align = "start",
  tone = "default",
  className = "",
}: BigNumberProps) {
  const numeric = typeof value === "number" ? value : null;
  const [ref, inView] = useInView<HTMLElement>({ threshold: 0.4 });
  const [shown, setShown] = useState<number>(() => {
    if (numeric === null) return 0;
    return countUp ? 0 : numeric;
  });
  const animated = useRef<number | null>(null);
  const current = useRef<number>(0);

  useEffect(() => {
    if (numeric === null) return;
    if (!inView) return;
    if (animated.current === numeric) return;

    animated.current = numeric;

    let frame = 0;

    if (!countUp || prefersReducedMotion()) {
      frame = requestAnimationFrame(() => {
        current.current = numeric;
        setShown(numeric);
      });
      return () => cancelAnimationFrame(frame);
    }

    const from = current.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (numeric - from) * eased;
      current.current = next;
      setShown(next);
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        current.current = numeric;
        setShown(numeric);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [inView, numeric, countUp, duration]);

  const text = numeric === null ? String(value) : shown.toFixed(decimals);
  const unitStyle = { fontSize: "0.52em", letterSpacing: "-0.02em" };
  const Tag: ElementType = as ?? "div";

  return (
    <Tag ref={ref} className={`${align === "center" ? "text-center" : ""} ${className}`.trim()}>
      <p
        className="t-figure"
        style={{ color: tone === "accent" ? "var(--accent)" : "var(--foreground)" }}
      >
        {prefix ? <span style={unitStyle}>{prefix}</span> : null}
        <span>{text}</span>
        {suffix ? <span style={unitStyle}>{suffix}</span> : null}
      </p>
      <p className="t-title mt-3">{label}</p>
      {detail ? <p className="t-small mt-1">{detail}</p> : null}
    </Tag>
  );
}
