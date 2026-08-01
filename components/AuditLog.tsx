"use client";

import { useState } from "react";
import type { AuditEntry } from "@/lib/store";
import { clock, timeAgo } from "./format";

interface Props {
  entries: AuditEntry[];
  initial?: number;
}

const CHIP = "border-white/12 bg-white/[0.05] text-zinc-300";

const KIND: Record<string, { label: string; dot: string; chip: string }> = {
  product: { label: "Product", dot: "bg-zinc-600", chip: CHIP },
  research: { label: "Research", dot: "bg-zinc-500", chip: CHIP },
  creatives: { label: "Creatives", dot: "bg-zinc-400", chip: CHIP },
  simulate: { label: "Traffic", dot: "bg-zinc-500", chip: CHIP },
  decision: { label: "Decision", dot: "bg-zinc-300", chip: CHIP },
  purchase: { label: "Purchase", dot: "bg-zinc-200", chip: CHIP },
  mandate: { label: "Mandate", dot: "bg-zinc-400", chip: CHIP },
};

export default function AuditLog({ entries, initial = 8 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(0, initial);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
      {entries.length === 0 ? (
        <p className="text-[13px] text-zinc-400">
          Nothing yet. Every move the agent makes lands here, in the order it made them.
        </p>
      ) : (
        <ol className="space-y-0">
          {shown.map((entry, i) => {
            const kind = KIND[entry.kind] ?? {
              label: entry.kind,
              dot: "bg-zinc-600",
              chip: CHIP,
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
                    <span className="text-[11px] tabular-nums text-zinc-400">
                      {timeAgo(entry.at)}, {clock(entry.at)}
                    </span>
                  </div>
                  <p className="mt-1 break-words [overflow-wrap:anywhere] text-[13px] leading-relaxed text-zinc-300">
                    {entry.detail}
                  </p>
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
