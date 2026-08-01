"use client";

import Image from "next/image";
import type { Creative } from "@/lib/store";
import { ctr, pct, shortId } from "./format";
import { useCountUp } from "./motion";

interface Props {
  creative: Creative;
  isWinner?: boolean;
  isLeader?: boolean;
  probabilityBest?: number | null;
  bestCtr?: number;
  parentHeadline?: string | null;
  retired?: boolean;
  onEvolve?: (id: string) => void;
  evolving?: boolean;
  index?: number;
}

const ANGLE_STYLE: Record<string, string> = {
  price: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  ritual: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  gift: "border-pink-400/30 bg-pink-400/10 text-pink-300",
  quality: "border-amber-400/30 bg-amber-400/10 text-amber-300",
};

const ANGLE_GLOW: Record<string, string> = {
  price: "from-sky-500/25",
  ritual: "from-violet-500/25",
  gift: "from-pink-500/25",
  quality: "from-amber-500/25",
};

function Metric({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tint ?? "text-zinc-100"}`}>{value}</div>
    </div>
  );
}

export default function CreativeCard({
  creative,
  isWinner,
  isLeader,
  probabilityBest,
  bestCtr,
  parentHeadline,
  retired,
  onEvolve,
  evolving,
  index = 0,
}: Props) {
  const rate = ctr(creative.arm.impressions, creative.arm.clicks);
  const reference = bestCtr && bestCtr > 0 ? bestCtr : rate;
  const fill = reference > 0 ? Math.max(0.04, Math.min(1, rate / reference)) : 0;
  const angleStyle = ANGLE_STYLE[creative.angle] ?? "border-zinc-500/30 bg-white/5 text-zinc-300";

  const shownImpressions = useCountUp(creative.arm.impressions);
  const shownClicks = useCountUp(creative.arm.clicks);
  const shownRate = useCountUp(rate);

  return (
    <article
      style={retired ? undefined : { animationDelay: `${Math.min(index, 7) * 70}ms` }}
      className={`${retired ? "opacity-60" : "enter"} relative flex flex-col overflow-hidden rounded-2xl border transition-colors ${
        isWinner
          ? "border-emerald-400/60 bg-emerald-400/[0.06] shadow-[0_0_0_1px_rgba(52,211,153,0.25),0_18px_40px_-24px_rgba(16,185,129,0.8)]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      {isWinner ? (
        <div className="flex items-center justify-between gap-2 bg-emerald-400/15 px-3 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-300">
            Winning candidate
          </span>
          {typeof probabilityBest === "number" ? (
            <span className="text-[11px] font-semibold tabular-nums text-emerald-200">
              {pct(probabilityBest)} probability best
            </span>
          ) : null}
        </div>
      ) : isLeader ? (
        <div className="bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Leading on simulated clicks
        </div>
      ) : null}

      <div className="relative aspect-[16/9] w-full overflow-hidden bg-zinc-900 sm:aspect-[4/3]">
        {creative.imageData ? (
          <Image
            src={creative.imageData}
            alt={creative.headline}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, 320px"
            className="object-cover"
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${
              ANGLE_GLOW[creative.angle] ?? "from-zinc-500/20"
            } to-transparent`}
          >
            <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">
              No image returned
            </span>
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur ${angleStyle}`}
          >
            {creative.angle}
          </span>
          <span className="rounded-full border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 backdrop-blur">
            Gen {creative.generation}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <div>
          <h3 className="break-words text-[15px] font-semibold leading-snug text-white">
            {creative.headline}
          </h3>
          <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-400">
            {creative.body}
          </p>
        </div>

        <div className="break-words text-[11px] leading-relaxed text-zinc-400">
          {creative.parentId ? (
            <>
              Bred from {parentHeadline ? `"${parentHeadline}"` : shortId(creative.parentId)}, the
              winner of generation {Math.max(0, creative.generation - 1)}.
            </>
          ) : (
            <>Seed variant, no parent. Targets {creative.targetEmotion}.</>
          )}
        </div>

        <div className="mt-auto">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-400/80">
              Simulated performance
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Metric label="Impr." value={Math.round(shownImpressions).toLocaleString()} />
            <Metric label="Clicks" value={Math.round(shownClicks).toLocaleString()} />
            <Metric
              label="CTR"
              value={pct(shownRate, 2)}
              tint={isWinner ? "text-emerald-300" : "text-zinc-100"}
            />
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`bar-fill h-full w-full ${isWinner ? "bg-emerald-400" : "bg-zinc-500"}`}
              style={{ transform: `scaleX(${fill})` }}
            />
          </div>
        </div>

        {isWinner && onEvolve ? (
          <button
            type="button"
            onClick={() => onEvolve(creative.id)}
            disabled={evolving}
            className="mt-1 w-full rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-[13px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {evolving ? "Breeding the next generation" : "Breed 4 variants from this one"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
