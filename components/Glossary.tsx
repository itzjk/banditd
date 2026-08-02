"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const GLOSSARY_TERMS = {
  "four-gates": {
    label: "four gates",
    body: "Four conditions, and all four have to hold before a cent moves: enough traffic on the candidate, one ad clearly ahead, a gap big enough to be worth money, and a result that holds up to repeated looks. The last two are there because a 95% probability of being best is not a 5% chance of being wrong. That number means different things with 2 variants than with 4, and it inflates every time you look at it: on identical variants, checking 48 times pushes the false alarm rate from 10.5% to 44.5%. The anytime-valid boundary holds no matter how often we look. Measured on 200 runs against known truth, the four together take the false alarm rate down to 2.5%.",
  },
  "thompson-sampling": {
    label: "Thompson sampling",
    body: "Instead of splitting traffic evenly, each ad gets shown in proportion to how likely it currently is to be the best. Winners earn more traffic while they are still proving themselves, so less money is spent on the ones already losing.",
  },
  "multi-armed-bandit": {
    label: "multi-armed bandit",
    body: "The name comes from slot machines. You have four levers, you don't know which pays best, and every pull costs money. The question is not just which one wins, it is how much you are willing to spend finding out.",
  },
  mandate: {
    label: "mandate",
    body: "A signed permission, not a stored card. It sets a spending ceiling, one allowed merchant, and an expiry date. The agent never sees a card number: each charge mints a single-use credential. The seller signs it once with a passkey and can revoke it at any time.",
  },
} as const;

export type GlossaryTermId = keyof typeof GLOSSARY_TERMS;

let openId: string | null = null;
const listeners = new Set<() => void>();

function setOpenId(next: string | null) {
  openId = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return openId;
}

function getServerSnapshot(): string | null {
  return null;
}

interface Position {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface Props {
  term: GlossaryTermId;
  children?: ReactNode;
}

export default function Glossary({ term, children }: Props) {
  const entry = GLOSSARY_TERMS[term];
  const panelId = useId();
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const open = current === panelId;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(320, vw - margin * 2);
    const height = panelRef.current?.offsetHeight ?? 200;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, vw - margin - width));

    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const above = height > spaceBelow && spaceAbove > spaceBelow;
    const top = above ? Math.max(margin, rect.top - gap - height) : rect.bottom + gap;
    const maxHeight = Math.max(120, above ? spaceAbove : spaceBelow);

    setPosition({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenId(null);
      triggerRef.current?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpenId(null);
    }

    function reposition() {
      place();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpenId(open ? null : panelId)}
        className={`inline cursor-pointer rounded-sm text-left underline decoration-dotted decoration-1 underline-offset-4 transition-colors ${
          open ? "text-foreground decoration-accent" : "decoration-border-strong hover:text-foreground"
        }`}
      >
        {children ?? entry.label}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
        <span
          ref={panelRef}
          role="dialog"
          aria-label={entry.label}
          tabIndex={-1}
          id={panelId}
          className="card fixed z-[999] overflow-y-auto p-4 text-left shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            width: position?.width ?? 320,
            maxHeight: position?.maxHeight,
            visibility: position ? "visible" : "hidden",
          }}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="eyebrow text-muted">{entry.label}</span>
            <button
              type="button"
              aria-label="Close explanation"
              onClick={() => {
                setOpenId(null);
                triggerRef.current?.focus();
              }}
              className="-mr-1 -mt-1 shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-sm leading-none text-muted transition-colors hover:text-foreground"
            >
              ×
            </button>
          </span>
          <span className="mt-2 block text-[0.8125rem] leading-relaxed text-muted">
            {entry.body}
          </span>
        </span>,
            document.body,
          )
        : null}
    </>
  );
}
