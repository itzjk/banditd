import type { HTMLAttributes, ReactNode } from "react";
import { createElement } from "react";

export type SurfaceLevel = "quiet" | "base" | "raised" | "feature";
export type SurfaceTag =
  | "div"
  | "section"
  | "article"
  | "aside"
  | "header"
  | "footer"
  | "li"
  | "label";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  level?: SurfaceLevel;
  as?: SurfaceTag;
  interactive?: boolean;
  padded?: boolean;
  className?: string;
  children?: ReactNode;
}

const LEVELS: Record<SurfaceLevel, string> = {
  quiet: "surface-quiet",
  base: "surface-base",
  raised: "surface-raised",
  feature: "surface-feature",
};

const PADDING: Record<SurfaceLevel, string> = {
  quiet: "p-4",
  base: "p-4 sm:p-5",
  raised: "p-5 sm:p-6",
  feature: "p-6 sm:p-8",
};

export default function Surface({
  level = "base",
  as = "div",
  interactive = false,
  padded = false,
  className = "",
  children,
  ...rest
}: SurfaceProps) {
  const classes = [
    LEVELS[level],
    padded ? PADDING[level] : "",
    interactive ? "surface-interactive focus-ring" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return createElement(as, { ...rest, className: classes }, children);
}
