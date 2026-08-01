"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Creative } from "@/lib/store";
import { ctr, pct } from "./format";

interface Props {
  creatives: Creative[];
  winnerId?: string | null;
}

interface Row {
  generation: number;
  nodes: Creative[];
  winner: Creative | null;
  confirmed: boolean;
}

interface Link {
  key: string;
  d: string;
  x: number;
  y: number;
  strong: boolean;
  pending: boolean;
  delay: number;
}

const PENDING = "pending-generation";

const ANGLE_STYLE: Record<string, string> = {
  price: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  ritual: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  gift: "border-pink-400/30 bg-pink-400/10 text-pink-300",
  quality: "border-amber-400/30 bg-amber-400/10 text-amber-300",
};

function buildRows(creatives: Creative[], winnerId?: string | null): Row[] {
  const byGeneration = new Map<number, Creative[]>();
  for (const c of creatives) {
    const bucket = byGeneration.get(c.generation);
    if (bucket) bucket.push(c);
    else byGeneration.set(c.generation, [c]);
  }

  return [...byGeneration.keys()]
    .sort((a, b) => a - b)
    .map((generation) => {
      const nodes = byGeneration.get(generation) ?? [];
      const children = byGeneration.get(generation + 1) ?? [];
      const parents = new Set(
        children.map((c) => c.parentId).filter((id): id is string => Boolean(id)),
      );

      const bred = nodes.find((n) => parents.has(n.id)) ?? null;
      const declared = winnerId ? (nodes.find((n) => n.id === winnerId) ?? null) : null;
      const scored = nodes.reduce<Creative | null>((best, node) => {
        if (!node.arm.impressions) return best;
        if (!best) return node;
        const a = ctr(node.arm.impressions, node.arm.clicks);
        const b = ctr(best.arm.impressions, best.arm.clicks);
        return a > b ? node : best;
      }, null);

      return {
        generation,
        nodes,
        winner: bred ?? declared ?? scored,
        confirmed: Boolean(bred),
      };
    });
}

function Node({
  creative,
  isWinner,
  register,
}: {
  creative: Creative;
  isWinner: boolean;
  register: (id: string, el: HTMLDivElement | null) => void;
}) {
  const rate = ctr(creative.arm.impressions, creative.arm.clicks);
  const angle = ANGLE_STYLE[creative.angle] ?? "border-zinc-500/30 bg-white/5 text-zinc-300";

  return (
    <div
      ref={(el) => {
        register(creative.id, el);
      }}
      className={`relative flex flex-col gap-1.5 rounded-xl border p-2 transition-colors ${
        isWinner
          ? "border-emerald-400/60 bg-emerald-400/[0.08] shadow-[0_0_0_1px_rgba(52,211,153,0.2)]"
          : "border-white/10 bg-zinc-950"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${angle}`}
        >
          {creative.angle}
        </span>
        {isWinner ? (
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-300">
            Winner
          </span>
        ) : null}
      </div>

      <p
        className={`line-clamp-2 text-[11px] font-medium leading-snug ${
          isWinner ? "text-white" : "text-zinc-300"
        }`}
        title={creative.headline}
      >
        {creative.headline}
      </p>

      <div className="mt-auto flex items-baseline justify-between gap-1">
        <span
          className={`text-[13px] font-semibold tabular-nums ${
            isWinner ? "text-emerald-300" : "text-zinc-200"
          }`}
        >
          {creative.arm.impressions ? pct(rate, 2) : "no data"}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-amber-400/70">sim CTR</span>
      </div>

      <div className="text-[9px] tabular-nums text-zinc-500">
        {creative.arm.impressions.toLocaleString()} impr, {creative.arm.clicks.toLocaleString()}{" "}
        clicks
      </div>
    </div>
  );
}

export default function LineageTree({ creatives, winnerId }: Props) {
  const rows = useMemo(() => buildRows(creatives, winnerId), [creatives, winnerId]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const [links, setLinks] = useState<Link[]>([]);

  const register = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) elements.current.set(id, el);
    else elements.current.delete(id);
  }, []);

  const measure = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const drawn: Link[] = [];

    const curve = (
      key: string,
      from: HTMLDivElement,
      to: HTMLDivElement,
      strong: boolean,
      pending: boolean,
      delay: number,
    ) => {
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - base.left;
      const y1 = a.bottom - base.top;
      const x2 = b.left + b.width / 2 - base.left;
      const y2 = b.top - base.top;
      const mid = y1 + (y2 - y1) / 2;
      drawn.push({
        key,
        d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
        x: x1,
        y: y1,
        strong,
        pending,
        delay,
      });
    };

    for (let i = 0; i < rows.length - 1; i += 1) {
      const winner = rows[i].winner;
      rows[i + 1].nodes.forEach((child, index) => {
        const sourceId =
          child.parentId && elements.current.has(child.parentId) ? child.parentId : winner?.id;
        if (!sourceId) return;
        const from = elements.current.get(sourceId);
        const to = elements.current.get(child.id);
        if (!from || !to) return;
        curve(`${sourceId}-${child.id}`, from, to, sourceId === winner?.id, false, index * 60);
      });
    }

    const last = rows[rows.length - 1];
    const ghost = elements.current.get(PENDING);
    if (last?.winner && ghost) {
      const from = elements.current.get(last.winner.id);
      if (from) curve(PENDING, from, ghost, true, true, 0);
    }

    setLinks(drawn);
  }, [rows]);

  useEffect(() => {
    measure();
    const frame = requestAnimationFrame(measure);
    const root = containerRef.current;
    const observer = new ResizeObserver(measure);
    if (root) observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure]);

  if (!rows.length) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
        <h2 className="text-sm font-semibold tracking-tight text-white">Lineage</h2>
        <div className="mt-3 rounded-xl border border-dashed border-white/12 p-6 text-center">
          <p className="text-[13px] text-zinc-500">
            The family tree draws itself here as soon as the agent writes its first four creatives.
          </p>
        </div>
      </section>
    );
  }

  const onlySeed = rows.length === 1;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-white">
          Lineage of the winners
        </h2>
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
          CTR simulated
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
        One row per generation. The winner of each row is the parent of the next one, so the whole
        loop reads top to bottom.
      </p>
      <p className="mt-1 text-[11px] text-zinc-600 sm:hidden">Swipe the tree sideways.</p>

      <div className="mt-3 overflow-x-auto pb-1">
        <div ref={containerRef} className="relative min-w-[32rem] sm:min-w-0">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
            fill="none"
          >
            {links.map((link) => (
              <g key={link.key}>
                <path
                  className={link.pending ? "enter-soft" : "link-draw"}
                  style={{ animationDelay: `${link.delay}ms` }}
                  pathLength={link.pending ? undefined : 1}
                  d={link.d}
                  stroke={
                    link.pending
                      ? "rgba(52,211,153,0.3)"
                      : link.strong
                        ? "rgba(52,211,153,0.55)"
                        : "rgba(255,255,255,0.12)"
                  }
                  strokeWidth={link.strong || link.pending ? 1.5 : 1}
                  strokeDasharray={link.pending ? "4 5" : undefined}
                  strokeLinecap="round"
                />
                <circle
                  className="enter-soft"
                  style={{ animationDelay: `${link.delay}ms` }}
                  cx={link.x}
                  cy={link.y}
                  r={2}
                  fill={link.strong || link.pending ? "rgba(52,211,153,0.75)" : "rgba(255,255,255,0.2)"}
                />
              </g>
            ))}
          </svg>

          <div className="relative">
            {rows.map((row, index) => {
              const next = rows[index + 1];
              const winnerRate = row.winner
                ? ctr(row.winner.arm.impressions, row.winner.arm.clicks)
                : 0;

              return (
                <div key={row.generation}>
                  <div className="sticky left-0 mb-2 flex w-fit flex-wrap items-center gap-2">
                    <span className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                      Gen {row.generation}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {row.nodes.length} {row.nodes.length === 1 ? "variant" : "variants"}
                    </span>
                    {row.winner && row.winner.arm.impressions ? (
                      <span className="text-[11px] tabular-nums text-emerald-300/80">
                        best {pct(winnerRate, 2)}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-4 gap-2 sm:gap-3">
                    {row.nodes.map((creative) => (
                      <Node
                        key={creative.id}
                        creative={creative}
                        isWinner={creative.id === row.winner?.id}
                        register={register}
                      />
                    ))}
                  </div>

                  {next ? (
                    <div className="flex h-20 items-center justify-center px-2 sm:h-24">
                      <div className="sticky left-0 max-w-full rounded-full border border-emerald-400/25 bg-zinc-950 px-3 py-1.5 text-center">
                        <p className="text-[10px] leading-snug text-zinc-400 sm:text-[11px]">
                          <span className="font-semibold text-emerald-300">
                            Agent bought render credits
                          </span>
                          , then bred {next.nodes.length} variants of the Gen {row.generation}{" "}
                          winner.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {onlySeed ? (
              <>
                <div className="h-16 sm:h-20" />
                <div
                  ref={(el) => {
                    register(PENDING, el);
                  }}
                  className="rounded-xl border border-dashed border-emerald-400/25 bg-emerald-400/[0.03] px-3 py-4 text-center"
                >
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300/70">
                    Gen 1
                  </div>
                  <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-zinc-500">
                    The descendants show up here once the agent buys its own credits and breeds four
                    variants of the winner above.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
