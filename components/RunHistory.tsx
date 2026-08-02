"use client";

import { useMemo, useState } from "react";
import type { ArchivedAd, ArchivedRun } from "@/lib/history";
import { adCtr, runnerUpCtr, winnerCtr } from "@/lib/history";
import { money, pct } from "./format";

interface Props {
  runs: ArchivedRun[];
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function points(a: number, b: number): string {
  return `${(Math.abs(a - b) * 100).toFixed(2)} points`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className="mt-0.5 break-words text-[14px] font-semibold tabular-nums text-white">
        {value}
      </div>
    </div>
  );
}

function AdCard({ ad, isWinner }: { ad: ArchivedAd; isWinner: boolean }) {
  return (
    <article
      className={`flex h-full min-w-0 flex-col rounded-xl border p-3 ${
        isWinner ? "border-white/40 bg-white/[0.06]" : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
          {ad.angle}
        </span>
        {isWinner ? (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-950">
            Winner
          </span>
        ) : null}
      </div>
      <h4 className="t-caption mt-2 break-words font-semibold leading-snug text-white">
        {ad.headline || "Untitled ad"}
      </h4>
      <dl className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-white/[0.04] px-1.5 py-1.5">
          <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">Impr.</dt>
          <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-100">
            {ad.impressions.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-lg bg-white/[0.04] px-1.5 py-1.5">
          <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">Clicks</dt>
          <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-100">
            {ad.clicks.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-lg bg-white/[0.04] px-1.5 py-1.5">
          <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">CTR</dt>
          <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-100">
            {pct(adCtr(ad), 2)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function Comparison({ left, right }: { left: ArchivedRun; right: ArchivedRun }) {
  const sides = [left, right];
  const sameAngle = Boolean(
    left.winner && right.winner && left.winner.angle === right.winner.angle,
  );
  const gapBetween = points(winnerCtr(left), winnerCtr(right));

  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.03] p-3 sm:p-4">
      <h4 className="t-caption break-words font-semibold text-white">
        Which angle won on each product
      </h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {sides.map((run, i) => {
          const top = winnerCtr(run);
          const next = runnerUpCtr(run);
          return (
            <section
              key={run.id}
              className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-3"
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                {i === 0 ? "First pick" : "Second pick"}
              </div>
              <h5 className="t-caption mt-1 break-words font-semibold text-white [overflow-wrap:anywhere]">
                {run.product.name}
              </h5>
              <div className="mt-2 text-[22px] font-semibold capitalize leading-none text-white">
                {run.winner ? run.winner.angle : "no winner"}
              </div>
              <p className="mt-1 break-words text-[12px] leading-snug text-zinc-400">
                {run.winner
                  ? `"${run.winner.headline}"`
                  : "This run never served enough traffic to name one."}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Winner CTR" value={pct(top, 2)} />
                <Field label="Ahead by" value={points(top, next)} />
                <Field label="Impressions" value={run.impressions.toLocaleString()} />
                <Field label="Spent" value={`$${money(run.spent)}`} />
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-3 break-words text-[13px] leading-relaxed text-zinc-200">
        {left.winner && right.winner
          ? sameAngle
            ? `The ${left.winner.angle} angle won both times, and the two winners sit ${gapBetween} apart on click through rate. Two runs is not evidence that the angle travels, but it is worth testing again.`
            : `The ${left.winner.angle} angle won on ${left.product.name} and the ${right.winner.angle} angle won on ${right.product.name}, with ${gapBetween} between the two winning rates. Two runs, two different answers, so neither angle is a default here.`
          : "One of these runs never named a winner, so there is nothing to compare yet."}
      </p>
    </div>
  );
}

function Row({
  run,
  picked,
  onOpen,
  onPick,
}: {
  run: ArchivedRun;
  picked: boolean;
  onOpen: () => void;
  onPick: () => void;
}) {
  return (
    <li className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="t-caption min-w-0 break-words font-semibold text-white [overflow-wrap:anywhere]">
          {run.product.name}
        </h4>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{when(run.at)}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Field label="Winning angle" value={run.winner ? run.winner.angle : "none"} />
        <Field label="Winner CTR" value={pct(winnerCtr(run), 2)} />
        <Field label="Spent" value={`$${money(run.spent)}`} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-h-[2.75rem] flex-1 rounded-lg border border-white/20 bg-white/[0.06] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.14]"
        >
          Open this run
        </button>
        <button
          type="button"
          onClick={onPick}
          aria-pressed={picked}
          className={`min-h-[2.75rem] flex-1 rounded-lg border px-3 text-[13px] font-semibold transition-colors ${
            picked
              ? "border-white/45 bg-white text-zinc-950 hover:bg-zinc-200"
              : "border-white/12 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.09]"
          }`}
        >
          {picked ? "Picked to compare" : "Pick to compare"}
        </button>
      </div>
    </li>
  );
}

export default function RunHistory({ runs }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);

  const open = useMemo(() => runs.find((r) => r.id === openId) ?? null, [runs, openId]);
  const paired = useMemo(
    () => picks.map((id) => runs.find((r) => r.id === id)).filter((r): r is ArchivedRun => Boolean(r)),
    [picks, runs],
  );

  const pick = (id: string) => {
    setPicks((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      return [...prev, id].slice(-2);
    });
  };

  if (open) {
    return (
      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="min-h-[2.75rem] w-full rounded-lg border border-white/20 bg-white/[0.06] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.14] sm:w-auto"
        >
          Back to the current run
        </button>

        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Archived run, {when(open.at)}
          </div>
          <h3 className="t-small mt-1 break-words font-semibold text-white [overflow-wrap:anywhere]">
            {open.product.name}
          </h3>
          <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-400 [overflow-wrap:anywhere]">
            {open.product.description}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-4">
          <Field label="Price" value={open.product.price || "not given"} />
          <Field label="Winning angle" value={open.winner ? open.winner.angle : "none"} />
          <Field label="Winner CTR" value={pct(winnerCtr(open), 2)} />
          <Field label="Spent" value={`$${money(open.spent)}`} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {open.ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} isWinner={ad.id === open.winner?.id} />
          ))}
        </div>

        <p className="break-words text-[12px] leading-relaxed text-zinc-400">
          Generation {open.generation} on {open.impressions.toLocaleString()} simulated impressions,{" "}
          {open.charges} {open.charges === 1 ? "charge" : "charges"} through the mandate. The images
          are left out of the archive so the browser keeps room for more runs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="break-words text-[13px] leading-relaxed text-zinc-400">
        Every run filed here was archived the moment a new product took the board. Open one to read
        it back, or pick two and see which angle won on each.
      </p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {runs.map((run) => (
          <Row
            key={run.id}
            run={run}
            picked={picks.includes(run.id)}
            onOpen={() => setOpenId(run.id)}
            onPick={() => pick(run.id)}
          />
        ))}
      </ul>

      {paired.length === 2 ? (
        <div className="space-y-2">
          <Comparison left={paired[0]} right={paired[1]} />
          <button
            type="button"
            onClick={() => setPicks([])}
            className="min-h-[2.75rem] w-full rounded-lg border border-white/12 bg-white/[0.03] px-3 text-[13px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.09] sm:w-auto"
          >
            Clear the comparison
          </button>
        </div>
      ) : picks.length === 1 ? (
        <p className="break-words text-[13px] leading-relaxed text-zinc-300">
          One run picked. Pick a second one and the comparison opens here.
        </p>
      ) : null}
    </div>
  );
}
