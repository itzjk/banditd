"use client";

import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import { prefersReducedMotion } from "./useInView";

export interface ShelfProps {
  children: ReactNode;
  ariaLabel: string;
  as?: ElementType;
  title?: ReactNode;
  itemClassName?: string;
  gap?: "sm" | "md" | "lg";
  controls?: boolean;
  indicator?: boolean;
  fadeEdges?: boolean;
  snap?: boolean;
  wheel?: boolean;
  className?: string;
}

const GAPS: Record<NonNullable<ShelfProps["gap"]>, string> = {
  sm: "gap-3",
  md: "gap-4 sm:gap-5",
  lg: "gap-5 sm:gap-7",
};

const DEFAULT_ITEM = "w-[78%] sm:w-[52%] lg:w-[33%]";

export default function Shelf({
  children,
  ariaLabel,
  as,
  title,
  itemClassName = DEFAULT_ITEM,
  gap = "md",
  controls = true,
  indicator = true,
  fadeEdges = true,
  snap = true,
  wheel = false,
  className = "",
}: ShelfProps) {
  const scrollerRef = useRef<HTMLUListElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const x = el.scrollLeft;
    setOverflowing(max > 2);
    setAtStart(x <= 1);
    setAtEnd(x >= max - 1);

    const thumb = thumbRef.current;
    const track = trackRef.current;
    if (thumb && track && el.scrollWidth > 0) {
      const ratio = Math.min(1, el.clientWidth / el.scrollWidth);
      const width = track.clientWidth;
      const offset = max > 0 ? (x / max) * width * (1 - ratio) : 0;
      thumb.style.transform = `translateX(${offset.toFixed(2)}px) scaleX(${ratio.toFixed(4)})`;
    }
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };

    sync();
    el.addEventListener("scroll", onScroll, { passive: true });

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => sync()) : null;
    observer?.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [sync, children]);

  useEffect(() => {
    sync();
  }, [overflowing, sync]);

  useEffect(() => {
    if (!wheel) return;
    const el = scrollerRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      if (event.deltaY < 0 && el.scrollLeft <= 0) return;
      if (event.deltaY > 0 && el.scrollLeft >= max) return;
      event.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + event.deltaY));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheel]);

  const move = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(".bd-shelf-item");
    const gapPx = Number.parseFloat(window.getComputedStyle(el).columnGap || "0") || 0;
    const step = first ? first.offsetWidth + gapPx : el.clientWidth * 0.8;
    el.scrollBy({
      left: step * direction,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  const showControls = controls && overflowing;
  const Tag: ElementType = as ?? "div";

  return (
    <Tag className={className}>
      {title || showControls ? (
        <div className="flex items-end justify-between gap-4 mb-4">
          {title ? <h3 className="t-title">{title}</h3> : <span />}
          {showControls ? (
            <div className="hidden md:flex items-center gap-2">
              <button
                type="button"
                className="bd-shelf-arrow focus-ring"
                onClick={() => move(-1)}
                disabled={atStart}
                aria-label="Scroll left"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M10 3 5 8l5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="bd-shelf-arrow focus-ring"
                onClick={() => move(1)}
                disabled={atEnd}
                aria-label="Scroll right"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M6 3l5 5-5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ul
        ref={scrollerRef}
        role="list"
        aria-label={ariaLabel}
        tabIndex={0}
        className={`bd-shelf focus-ring pb-1 ${GAPS[gap]} ${fadeEdges ? "bd-shelf-fade" : ""}`}
        style={snap ? undefined : { scrollSnapType: "none" }}
      >
        {Children.map(children, (child) => (
          <li className={`bd-shelf-item ${itemClassName}`}>{child}</li>
        ))}
      </ul>

      {indicator && overflowing ? (
        <div ref={trackRef} className="bd-shelf-track mt-4" aria-hidden="true">
          <div ref={thumbRef} className="bd-shelf-thumb" />
        </div>
      ) : null}
    </Tag>
  );
}
