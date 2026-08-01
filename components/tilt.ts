"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";
const FINE = "(hover: hover) and (pointer: fine)";

function query(media: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(media);
}

function useMediaFlag(media: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = query(media);
      if (!list) return () => {};
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [media],
  );
  const read = useCallback(() => query(media)?.matches ?? false, [media]);
  const server = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, read, server);
}

export function useDepth(): boolean {
  return !useMediaFlag(REDUCED);
}

export function usePointerTilt(): boolean {
  const fine = useMediaFlag(FINE);
  const reduced = useMediaFlag(REDUCED);
  return fine && !reduced;
}

export function depthLayer(z: number, on: boolean, nested = false): CSSProperties | undefined {
  if (!on || z === 0) return nested && on ? { transformStyle: "preserve-3d" } : undefined;
  return nested
    ? { transform: `translateZ(${z}px)`, transformStyle: "preserve-3d" }
    : { transform: `translateZ(${z}px)` };
}

interface TiltOptions {
  max?: number;
  perspective?: number;
  disabled?: boolean;
}

export function useTilt<T extends HTMLElement>({
  max = 6,
  perspective = 900,
  disabled = false,
}: TiltOptions = {}) {
  const ref = useRef<T | null>(null);
  const on = usePointerTilt() && !disabled;

  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;

    let frame = 0;
    let point: { x: number; y: number } | null = null;

    const paint = () => {
      frame = 0;
      const target = point;
      if (!target) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dx = Math.max(-0.5, Math.min(0.5, (target.x - rect.left) / rect.width - 0.5));
      const dy = Math.max(-0.5, Math.min(0.5, (target.y - rect.top) / rect.height - 0.5));
      el.style.transform = `perspective(${perspective}px) rotateX(${(-dy * max * 2).toFixed(2)}deg) rotateY(${(dx * max * 2).toFixed(2)}deg)`;
    };

    const settle = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      point = null;
      el.style.transition = "transform 460ms cubic-bezier(0.22, 0.61, 0.36, 1)";
      el.style.transform = "";
    };

    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      el.style.willChange = "transform";
      el.style.transition = "transform 140ms cubic-bezier(0.22, 0.61, 0.36, 1)";
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      point = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onEnd = () => settle();

    const onSettled = (event: TransitionEvent) => {
      if (event.propertyName !== "transform" || point) return;
      el.style.willChange = "";
      el.style.transition = "";
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onEnd);
    el.addEventListener("pointercancel", onEnd);
    el.addEventListener("focusin", onEnd);
    el.addEventListener("transitionend", onSettled);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onEnd);
      el.removeEventListener("pointercancel", onEnd);
      el.removeEventListener("focusin", onEnd);
      el.removeEventListener("transitionend", onSettled);
      el.style.transform = "";
      el.style.transition = "";
      el.style.willChange = "";
    };
  }, [on, max, perspective]);

  return ref;
}

interface DeckOptions {
  index: number;
  active?: boolean;
  spread?: number;
  stagger?: number;
}

export function useDeckEntry({
  index,
  active = true,
  spread = 14,
  stagger = 85,
}: DeckOptions): CSSProperties | undefined {
  const on = useDepth() && active;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!on) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setOpen(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [on]);

  if (!on) return undefined;

  const slot = index % 4;
  const delay = Math.min(index, 7) * stagger;
  const shift = (1.5 - slot) * spread;
  const transition = `transform 620ms cubic-bezier(0.22, 0.61, 0.36, 1) ${delay}ms, opacity 400ms ease-out ${delay}ms`;

  if (open) return { transform: "none", opacity: 1, transition };

  return {
    transform: `perspective(1100px) translate3d(${shift}px, 12px, -190px) rotateY(-26deg)`,
    opacity: 0,
    transition,
  };
}
