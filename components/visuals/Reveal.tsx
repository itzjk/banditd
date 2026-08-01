"use client";

import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { useInView } from "./useInView";

export type RevealTag = ElementType;

export interface RevealProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: RevealTag;
  delay?: number;
  distance?: number;
  threshold?: number;
  once?: boolean;
  className?: string;
}

export default function Reveal({
  children,
  as,
  delay = 0,
  distance = 16,
  threshold = 0.15,
  once = true,
  className = "",
  style,
  ...rest
}: RevealProps) {
  const [ref, inView] = useInView<HTMLElement>({ threshold, once });
  const Tag: ElementType = as ?? "div";

  return (
    <Tag
      {...rest}
      ref={ref}
      className={`bd-reveal ${inView ? "bd-reveal-in" : ""} ${className}`.trim()}
      style={{
        ...style,
        ["--bd-reveal-delay" as string]: `${delay}ms`,
        ["--bd-reveal-distance" as string]: `${distance}px`,
      }}
    >
      {children}
    </Tag>
  );
}
