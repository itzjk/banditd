"use client";

import Image from "next/image";
import type { Creative } from "@/lib/store";
import { ctr, pct, shortId } from "./format";
import { useCountUp } from "./motion";
import { depthLayer, useDeckEntry, useDepth, useTilt } from "./tilt";
import WinnerExport from "./WinnerExport";

interface Props {
  creative: Creative;
  productName?: string | null;
  isWinner?: boolean;
  isLeader?: boolean;
  probabilityBest?: number | null;
  bestCtr?: number;
  parentHeadline?: string | null;
  retired?: boolean;
  onEvolve?: (id: string) => void;
  evolving?: boolean;
  index?: number;
  rendering?: boolean;
}

const ANGLE_STYLE = "border-white/20 bg-black/55 text-zinc-200";

function Metric({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">{label}</div>
      <div
        className={`mt-0.5 text-[15px] font-semibold tabular-nums sm:text-sm ${tint ?? "text-zinc-100"}`}
      >
        {value}
      </div>
    </div>
  );
}

export default function CreativeCard({
  creative,
  productName,
  isWinner,
  isLeader,
  probabilityBest,
  bestCtr,
  parentHeadline,
  retired,
  onEvolve,
  evolving,
  index = 0,
  rendering,
}: Props) {
  const rate = ctr(creative.arm.impressions, creative.arm.clicks);
  const reference = bestCtr && bestCtr > 0 ? bestCtr : rate;
  const fill = reference > 0 ? Math.max(0.04, Math.min(1, rate / reference)) : 0;

  const shownImpressions = useCountUp(creative.arm.impressions);
  const shownClicks = useCountUp(creative.arm.clicks);
  const shownRate = useCountUp(rate);

  const depth = useDepth() && !retired;
  const entry = useDeckEntry({ index, active: !retired });
  const tiltRef = useTilt<HTMLElement>({ disabled: Boolean(retired), max: 5.5, perspective: 900 });
  const banner = Boolean(isWinner) || Boolean(isLeader);

  return (
    <div style={entry} className={`h-full ${retired ? "opacity-60" : ""}`}>
      <article
        ref={tiltRef}
        style={depth ? { transformStyle: "preserve-3d" } : undefined}
        className={`relative flex h-full flex-col rounded-2xl border transition-colors ${
          isWinner
            ? "border-white/45 bg-white/[0.06] shadow-[0_0_0_1px_rgba(255,255,255,0.18),0_18px_44px_-26px_rgba(255,255,255,0.35)]"
            : "border-white/10 bg-white/[0.02]"
        }`}
      >
        {isWinner ? (
          <div
            style={depthLayer(12, depth)}
            className="flex flex-wrap items-center justify-between gap-2 rounded-t-[15px] bg-white px-3 py-1.5"
          >
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950">
              Winning candidate
            </span>
            {typeof probabilityBest === "number" ? (
              <span className="text-[11px] font-semibold tabular-nums text-zinc-700">
                {pct(probabilityBest)} probability best
              </span>
            ) : null}
          </div>
        ) : isLeader ? (
          <div className="rounded-t-[15px] bg-white/[0.06] px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-300 lg:text-[11px]">
            Leading on simulated clicks
          </div>
        ) : null}

        <div className="relative" style={depthLayer(0, depth, true)}>
          <div
            className={`relative aspect-[16/9] w-full overflow-hidden bg-zinc-900 sm:aspect-[4/3] ${
              banner ? "" : "rounded-t-[15px]"
            }`}
          >
            {creative.imageData ? (
              <Image
                src={creative.imageData}
                alt={
                  creative.imagePrompt
                    ? `Ad image for the ${creative.angle} angle: ${creative.imagePrompt}`
                    : `Ad image for the ${creative.angle} angle`
                }
                fill
                unoptimized
                sizes="(max-width: 640px) 100vw, 320px"
                className="object-cover"
              />
            ) : rendering ? (
              <div className="flex h-full w-full animate-pulse items-center justify-center bg-gradient-to-br from-white/[0.10] to-transparent">
                <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-300">
                  Rendering the image
                </span>
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.08] to-transparent">
                <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                  No image returned
                </span>
              </div>
            )}
          </div>
          <div
            style={depthLayer(26, depth)}
            className="absolute left-2 top-2 flex flex-wrap gap-1.5"
          >
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] backdrop-blur ${ANGLE_STYLE}`}
            >
              {creative.angle}
            </span>
            <span className="rounded-full border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300 backdrop-blur">
              Gen {creative.generation}
            </span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4" style={depthLayer(0, depth, true)}>
          <div style={depthLayer(16, depth)}>
            <h3 className="t-small break-words font-semibold leading-snug text-white">
              {creative.headline}
            </h3>
            <p className="mt-1.5 break-words text-[14px] leading-relaxed text-zinc-400 sm:mt-1 sm:text-[13px]">
              {creative.body}
            </p>
          </div>

          <div
            style={depthLayer(8, depth)}
            className="break-words text-[12px] leading-relaxed text-zinc-400"
          >
            {creative.parentId ? (
              <>
                Bred from {parentHeadline ? `"${parentHeadline}"` : shortId(creative.parentId)}, the
                winner of generation {Math.max(0, creative.generation - 1)}.
              </>
            ) : (
              <>Seed variant, no parent. Targets {creative.targetEmotion}.</>
            )}
          </div>

          <div className="mt-auto" style={depthLayer(12, depth)}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Simulated performance
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Metric label="Impr." value={Math.round(shownImpressions).toLocaleString()} />
              <Metric label="Clicks" value={Math.round(shownClicks).toLocaleString()} />
              <Metric
                label="CTR"
                value={pct(shownRate, 2)}
                tint={isWinner ? "text-white" : "text-zinc-100"}
              />
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="bar-fill h-full w-full"
                style={{
                  transform: `scaleX(${fill})`,
                  backgroundColor: retired ? "#52525b" : `var(--curve-${(index % 4) + 1})`,
                }}
              />
            </div>
          </div>

          {isWinner && onEvolve ? (
            <button
              type="button"
              onClick={() => onEvolve(creative.id)}
              disabled={evolving}
              style={depthLayer(22, depth)}
              className="mt-1 min-h-[2.75rem] w-full rounded-xl border border-white/25 bg-white/[0.08] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {evolving ? "Breeding the next generation" : "Breed 4 variants from this one"}
            </button>
          ) : null}

          {isWinner && !retired ? (
            <WinnerExport
              creative={creative}
              productName={productName}
              probabilityBest={probabilityBest}
              style={depthLayer(22, depth)}
            />
          ) : null}
        </div>
      </article>
    </div>
  );
}
