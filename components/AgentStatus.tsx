"use client";

import { useEffect, useState } from "react";

interface Props {
  title: string;
  steps: string[];
  intervalMs?: number;
}

export default function AgentStatus({ title, steps, intervalMs = 2200 }: Props) {
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const key = steps.join("|");
  const [track, setTrack] = useState(key);

  if (track !== key) {
    setTrack(key);
    setIndex(0);
    setElapsed(0);
  }

  useEffect(() => {
    const total = key.split("|").length;
    const step = setInterval(() => {
      setIndex((i) => (i + 1 < total ? i + 1 : i));
    }, intervalMs);
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(step);
      clearInterval(tick);
    };
  }, [key, intervalMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-300 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-zinc-200" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-200">
              {title}
            </div>
            <div className="truncate text-[13px] text-zinc-200">{steps[index] ?? steps[0]}</div>
          </div>
        </div>
        <div className="text-[11px] tabular-nums text-zinc-400">{elapsed}s</div>
      </div>

      <div className="h-0.5 w-full overflow-hidden bg-white/10">
        <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-zinc-300/80" />
      </div>

      <ol className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-2.5 pt-2 sm:px-4">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-1.5 text-[11px] ${
              i < index ? "text-zinc-400 line-through" : i === index ? "text-zinc-200" : "text-zinc-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                i < index ? "bg-zinc-600" : i === index ? "bg-zinc-200" : "bg-zinc-700"
              }`}
            />
            {s}
          </li>
        ))}
      </ol>

      <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
    </div>
  );
}
