"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "@/lib/store";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  state: State | null;
}

const MAX_QUESTION = 700;
const MAX_TURNS = 10;

const SUGGESTIONS = [
  "Why did this ad win?",
  "Why have you not bought yet?",
  "What is the E value?",
  "How much have you spent?",
];

const WORKING = [
  "Reading the run",
  "Checking the gate numbers",
  "Writing the answer",
];

function stripImages(state: State | null): State | null {
  if (!state) return null;
  return { ...state, creatives: state.creatives.map((c) => ({ ...c, imageData: null })) };
}

export default function AgentChat({ state }: Props) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [away, setAway] = useState(false);

  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stateRef = useRef<State | null>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setTick((n) => n + 1), 2400);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (open) return;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 48) setAway(false);
      else if (y > last + 8) setAway(true);
      else if (y < last - 8) setAway(false);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, busy, open]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim().slice(0, MAX_QUESTION);
      if (!text || busy) return;

      const history = [...turns, { role: "user" as const, content: text }].slice(-MAX_TURNS);
      setTurns(history);
      setDraft("");
      setError(null);
      setBusy(true);
      setTick(0);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history, state: stripImages(stateRef.current) }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          answer?: string;
          error?: string;
        };
        if (!res.ok || !payload.answer) {
          setError(payload.error ?? "The agent could not answer that one. Ask again.");
          return;
        }
        setTurns((prev) => [...prev, { role: "assistant", content: payload.answer as string }]);
      } catch {
        setError("Could not reach the agent. Check the connection and ask again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, turns],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask the agent about this run"
        className={`fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-zinc-900/95 text-[13px] font-semibold text-zinc-100 shadow-lg backdrop-blur transition-[transform,opacity] duration-200 hover:bg-zinc-800 sm:bottom-6 sm:right-6 sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-3 sm:pointer-events-auto sm:translate-y-0 sm:opacity-100 ${
          away ? "pointer-events-none translate-y-20 opacity-0" : ""
        }`}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 sm:hidden">
          <path
            d="M3.5 5.5h13v8h-7l-3.5 3v-3h-2.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span className="relative hidden h-2 w-2 sm:flex">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
        </span>
        <span className="hidden sm:inline">Ask the agent</span>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Chat with the banditd agent"
      className="fixed inset-x-3 bottom-3 z-50 flex h-[min(78vh,34rem)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-900/95 text-zinc-100 shadow-2xl backdrop-blur sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[24rem]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Ask the agent</div>
          <div className="text-[11px] leading-snug text-zinc-400">
            It answers from this run only, and it cannot spend.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close the chat"
          className="-mr-2 -my-1 flex min-h-[2.75rem] shrink-0 items-center rounded-lg px-2 text-[12px] uppercase tracking-wider text-zinc-400 transition-colors hover:text-white"
        >
          Close
        </button>
      </div>

      <div
        ref={logRef}
        aria-live="polite"
        className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {turns.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[13px] leading-relaxed text-zinc-300">
              Ask why a variant won, why the money stayed put, or what any number on this page
              means. Every answer is tied to the numbers of this run.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="inline-flex min-h-[2.75rem] items-center rounded-full border border-white/15 bg-white/[0.04] px-3 text-left text-[12px] text-zinc-200 transition-colors hover:bg-white/[0.12]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn, i) => (
          <div
            key={`${i}-${turn.role}`}
            className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                turn.role === "user"
                  ? "bg-white/[0.12] text-zinc-100"
                  : "border border-white/10 bg-white/[0.04] text-zinc-200"
              }`}
            >
              {turn.content}
            </div>
          </div>
        ))}

        {busy ? (
          <div role="status" className="flex items-center gap-2 text-[12px] text-zinc-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-300 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-zinc-300" />
            </span>
            {WORKING[Math.min(tick, WORKING.length - 1)]}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[12px] leading-snug text-rose-200">
            {error}
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/10 px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            maxLength={MAX_QUESTION}
            placeholder="Ask about this run"
            aria-label="Your question"
            className="max-h-24 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-white/30"
          />
          <button
            type="button"
            onClick={() => void send(draft)}
            disabled={busy || draft.trim().length === 0}
            className="min-h-[2.75rem] shrink-0 rounded-xl border border-white/20 bg-white/[0.10] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-zinc-500">
          Impressions and clicks are simulated. This chat is read only, it cannot charge the
          mandate.
        </p>
      </div>
    </div>
  );
}
