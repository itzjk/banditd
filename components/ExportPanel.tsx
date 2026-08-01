"use client";

import { useState } from "react";
import type { State } from "@/lib/store";

export type ExportSection = "creatives" | "purchases" | "audit" | "research" | "all";
export type ExportFormat = "json" | "csv";

interface Props {
  state: State | null;
  endpoint?: string;
  disabled?: boolean;
}

interface Choice {
  id: string;
  format: ExportFormat;
  section: ExportSection;
  label: string;
  hint: string;
  count: (state: State | null) => number;
}

const CHOICES: Choice[] = [
  {
    id: "json-all",
    format: "json",
    section: "all",
    label: "Whole run, JSON",
    hint: "Ads, research, sources, charges and the log in one file",
    count: (s) => (s?.creatives.length ?? 0) + (s?.purchases.length ?? 0) + (s?.audit.length ?? 0),
  },
  {
    id: "csv-creatives",
    format: "csv",
    section: "creatives",
    label: "Ads, CSV",
    hint: "Copy and performance, one row per ad, ready for your ad platform",
    count: (s) => s?.creatives.length ?? 0,
  },
  {
    id: "csv-purchases",
    format: "csv",
    section: "purchases",
    label: "Charges, CSV",
    hint: "Every charge and every block, with the reason the agent gave",
    count: (s) => s?.purchases.length ?? 0,
  },
  {
    id: "csv-all",
    format: "csv",
    section: "all",
    label: "Whole run, CSV",
    hint: "Product, research, ads, charges and log as one sectioned sheet",
    count: (s) => (s?.creatives.length ?? 0) + (s?.purchases.length ?? 0) + (s?.audit.length ?? 0),
  },
];

function nameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const found = header.match(/filename="?([^";]+)"?/);
  return found ? found[1] : fallback;
}

export default function ExportPanel({ state, endpoint = "/api/export", disabled }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const empty = !state || (!state.product && state.creatives.length === 0);

  async function pull(choice: Choice) {
    if (busy || disabled || empty) return;
    setBusy(choice.id);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, format: choice.format, section: choice.section }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "The export did not come back. Try again.");
        return;
      }

      const blob = await res.blob();
      const filename = nameFrom(
        res.headers.get("Content-Disposition"),
        `banditd-run.${choice.format}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDone(filename);
    } catch {
      setError("Network error while building the file. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Export the run"
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
    >
      <div className="border-b border-white/10 px-3 py-3 sm:px-4">
        <h3 className="text-sm font-semibold tracking-tight text-white">Take the run with you</h3>
        <p className="mt-0.5 break-words text-[12px] leading-relaxed text-zinc-400">
          The winning copy, the research behind it, the charges and the full log. Nothing here is
          locked in the demo.
        </p>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4">
        {CHOICES.map((choice) => {
          const rows = choice.count(state);
          const off = disabled || empty || rows === 0;
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => pull(choice)}
              disabled={off || busy !== null}
              className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-white/25 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-white/10 disabled:hover:bg-white/[0.03]"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="min-w-0 break-words text-[13px] font-semibold text-zinc-100">
                  {choice.label}
                </span>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {busy === choice.id ? "Building" : `${rows} rows`}
                </span>
              </div>
              <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-400">
                {choice.hint}
              </p>
            </button>
          );
        })}
      </div>

      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        {error ? (
          <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {error}
          </p>
        ) : done ? (
          <p
            role="status"
            className="break-all rounded-xl border border-emerald-400/30 bg-emerald-400/[0.07] px-3 py-2 text-[12px] leading-relaxed text-emerald-200"
          >
            Saved {done} to your downloads.
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed text-zinc-400">
            {empty
              ? "Nothing to export yet. Submit a product and let the agent write the first ads."
              : "Performance columns carry the simulated traffic from this demo and are labeled as such inside the file. Images are referenced by prompt, not embedded."}
          </p>
        )}
      </div>
    </section>
  );
}
