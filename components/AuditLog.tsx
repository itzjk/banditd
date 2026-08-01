"use client";

import { useState } from "react";
import type { AuditEntry } from "@/lib/store";
import { clock, timeAgo } from "./format";

interface Props {
  entries: AuditEntry[];
  initial?: number;
}

const KIND: Record<string, { label: string; dot: string; chip: string }> = {
  product: {
    label: "Product",
    dot: "bg-zinc-400",
    chip: "border-zinc-400/30 bg-zinc-400/10 text-zinc-300",
  },
  research: {
    label: "Research",
    dot: "bg-sky-400",
    chip: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  },
  creatives: {
    label: "Creatives",
    dot: "bg-violet-400",
    chip: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  },
  simulate: {
    label: "Traffic",
    dot: "bg-amber-400",
    chip: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  },
  decision: {
    label: "Decision",
    dot: "bg-emerald-400",
    chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  },
  purchase: {
    label: "Purchase",
    dot: "bg-rose-400",
    chip: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  },
  mandate: {
    label: "Mandate",
    dot: "bg-sky-300",
    chip: "border-sky-300/30 bg-sky-300/10 text-sky-200",
  },
};

export default function AuditLog({ entries, initial = 8 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(0, initial);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-white">Audit log</h2>
        <span className="text-[11px] text-zinc-500">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}, newest first
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-[13px] text-zinc-500">
          Nothing yet. Every move the agent makes lands here, in the order it made them.
        </p>
      ) : (
        <ol className="mt-3 space-y-0">
          {shown.map((entry, i) => {
            const kind = KIND[entry.kind] ?? {
              label: entry.kind,
              dot: "bg-zinc-500",
              chip: "border-zinc-500/30 bg-white/5 text-zinc-400",
            };
            return (
              <li key={`${entry.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                <div className="relative flex flex-col items-center">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${kind.dot}`} />
                  {i < shown.length - 1 ? (
                    <span className="absolute top-4 h-[calc(100%-0.5rem)] w-px bg-white/10" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${kind.chip}`}
                    >
                      {kind.label}
                    </span>
                    <span className="text-[11px] tabular-nums text-zinc-500">
                      {timeAgo(entry.at)}, {clock(entry.at)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{entry.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {entries.length > initial ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07]"
        >
          {expanded ? "Show less" : `Show all ${entries.length}`}
        </button>
      ) : null}
    </section>
  );
}
