"use client";

import { useState } from "react";
import type { AuditEntry } from "@/lib/store";
import { clock, plain, timeAgo } from "./format";

interface Props {
  entries: AuditEntry[];
  initial?: number;
}

const KIND: Record<string, string> = {
  product: "Product",
  research: "Research",
  creatives: "Creatives",
  simulate: "Traffic",
  decision: "Decision",
  purchase: "Purchase",
  mandate: "Mandate",
};

export default function AuditLog({ entries, initial = 8 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(0, initial);

  if (entries.length === 0) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <p className="text-[14px] leading-relaxed text-zinc-400">
          Nothing yet. Every move the agent makes lands here, in the order they happened.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <ol className="divide-y divide-white/[0.06]">
        {shown.map((entry, i) => (
          <li
            key={`${entry.at}-${i}`}
            className="grid gap-x-3 gap-y-1 px-3 py-2.5 transition-colors duration-150 hover:bg-white/[0.025] sm:grid-cols-[4.5rem_5.25rem_minmax(0,1fr)] sm:items-baseline sm:gap-y-0 sm:px-4"
          >
            <div className="flex items-center gap-2 sm:contents">
              <span className="shrink-0 text-[12px] tabular-nums text-zinc-400 sm:text-right">
                {clock(entry.at)}
              </span>
              <span className="w-fit shrink-0 rounded border border-white/12 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
                {KIND[entry.kind] ?? entry.kind}
              </span>
              <span className="text-[12px] tabular-nums text-zinc-400 sm:hidden">
                {timeAgo(entry.at)}
              </span>
            </div>
            <p className="min-w-0 break-words text-[14px] leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
              {plain(entry.detail)}
            </p>
          </li>
        ))}
      </ol>

      {entries.length > initial ? (
        <div className="border-t border-white/10 p-2 sm:p-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="min-h-[2.75rem] w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[14px] font-semibold text-zinc-300 transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
          >
            {expanded ? "Show less" : `Show all ${entries.length}`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
