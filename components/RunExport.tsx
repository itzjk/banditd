"use client";

import { useState } from "react";
import type { State } from "@/lib/store";
import type { RunEvaluation } from "./export-run";
import { runExportHtml, runFileName, saveText } from "./export-run";

interface Props {
  state: State | null;
  images: Record<string, string>;
  evaluation: RunEvaluation | null;
}

export default function RunExport({ state, images, evaluation }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const ready = Boolean(state && state.creatives.length > 0);

  const grab = () => {
    if (!state || !ready) return;
    try {
      const html = runExportHtml({ state, images, evaluation });
      const name = runFileName(state);
      saveText(html, name, "text/html;charset=utf-8");
      setNote(`Saved ${name}. Open it in any browser, the images travel inside the file.`);
    } catch {
      setNote("The file could not be built in this browser. Try again.");
    }
  };

  return (
    <section
      aria-label="Export the run"
      className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="t-small font-semibold text-white">
            Take the run with you
          </h3>
          <span className="shrink-0 rounded-full border border-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            One file
          </span>
        </div>
        <span className="max-w-md break-words text-[11px] leading-snug text-zinc-400">
          The four ads with their images and numbers, which one won, the four gates, the money it
          moved and what it recommends next.
        </span>
      </div>

      <button
        type="button"
        onClick={grab}
        disabled={!ready}
        className="mt-3 min-h-[3rem] w-full rounded-xl border border-white/25 bg-white/[0.08] px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {ready ? "Download the run as a web page" : "Nothing to export yet"}
      </button>

      <p className="mt-2 break-words text-[11px] leading-snug text-zinc-400">
        The file says on its face that the performance figures are simulated and that the payments
        ran against the Prava sandbox.
      </p>

      <p
        role="status"
        aria-live="polite"
        className="mt-1.5 min-h-[1rem] break-words text-[11px] leading-snug text-zinc-300"
      >
        {note}
      </p>
    </section>
  );
}
