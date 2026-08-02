"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Creative, PurchaseEvent } from "@/lib/store";
import { ctr, pct } from "./format";
import { useDepth } from "./tilt";

interface Props {
  creatives: Creative[];
  winnerId?: string | null;
  purchases?: PurchaseEvent[];
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

const ANGLE_STYLE = "border-white/15 bg-white/[0.06] text-zinc-300";

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

  return (
    <div
      ref={(el) => {
        register(creative.id, el);
      }}
      className={`relative flex flex-col gap-1.5 rounded-xl border p-2 transition-colors duration-150 ${
        isWinner
          ? "border-white/45 bg-white/[0.07] shadow-[0_0_0_1px_rgba(255,255,255,0.15)]"
          : "border-white/10 bg-zinc-950 hover:border-white/25"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${ANGLE_STYLE}`}
        >
          {creative.angle}
        </span>
        {isWinner ? (
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white">
            Winner
          </span>
        ) : null}
      </div>

      <p
        className={`line-clamp-2 break-words text-[11px] font-medium leading-snug [overflow-wrap:anywhere] ${
          isWinner ? "text-white" : "text-zinc-300"
        }`}
        title={creative.headline}
      >
        {creative.headline}
      </p>

      <div className="mt-auto border-t border-white/[0.08] pt-1.5">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
          Sim CTR
        </div>
        <div
          className={`text-[15px] font-semibold leading-tight tabular-nums ${
            isWinner ? "text-white" : "text-zinc-200"
          }`}
        >
          {creative.arm.impressions ? pct(rate, 2) : "no data"}
        </div>
        <div className="mt-0.5 break-words text-[10px] tabular-nums leading-snug text-zinc-400">
          {creative.arm.impressions.toLocaleString()} impr, {creative.arm.clicks.toLocaleString()}{" "}
          clicks
        </div>
      </div>
    </div>
  );
}

export default function LineageTree({ creatives, winnerId, purchases }: Props) {
  const rows = useMemo(() => buildRows(creatives, winnerId), [creatives, winnerId]);
  const paidGenerations = useMemo(() => {
    const generationOf = new Map(creatives.map((c) => [c.id, c.generation]));
    const paid = new Set<number>();
    for (const purchase of purchases ?? []) {
      if (!purchase.ok) continue;
      const generation = generationOf.get(purchase.winnerId);
      if (typeof generation === "number") paid.add(generation);
    }
    return paid;
  }, [creatives, purchases]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const generations = useRef(0);
  const [links, setLinks] = useState<Link[]>([]);
  const depth = useDepth();

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
    const sinking = generations.current !== rows.length;
    generations.current = rows.length;

    let frame = requestAnimationFrame(measure);
    if (sinking) {
      const start = performance.now();
      const follow = (now: number) => {
        measure();
        if (now - start < 640) frame = requestAnimationFrame(follow);
      };
      frame = requestAnimationFrame(follow);
    }

    const root = containerRef.current;
    const observer = new ResizeObserver(measure);
    if (root) observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure, rows.length]);

  if (!rows.length) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
        <div className="rounded-xl border border-dashed border-white/12 p-6 text-center">
          <p className="text-[13px] text-zinc-400">
            The family tree draws itself here as soon as the agent writes its first four creatives.
          </p>
        </div>
      </section>
    );
  }

  const onlySeed = rows.length === 1;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-white/10 pb-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold tabular-nums text-zinc-200">
            {rows.length} {rows.length === 1 ? "generation" : "generations"}, {creatives.length}{" "}
            {creatives.length === 1 ? "variant" : "variants"}
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-zinc-400">
            <span className="sm:hidden">Swipe the tree sideways. </span>
            Oldest at the top, the winner of each row breeds the next.
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Simulated traffic
        </span>
      </div>

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
                      ? "rgba(255,255,255,0.28)"
                      : link.strong
                        ? "rgba(255,255,255,0.5)"
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
                  fill={link.strong || link.pending ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)"}
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
              const back = Math.min(rows.length - 1 - index, 3);
              const sunk = back
                ? {
                    opacity: 1 - back * 0.14,
                    ...(depth
                      ? {
                          transform: `translateZ(${-32 * back}px)`,
                          transition:
                            "transform 560ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 560ms ease",
                        }
                      : null),
                  }
                : undefined;

              return (
                <div
                  key={row.generation}
                  style={depth && back ? { perspective: "1600px" } : undefined}
                >
                  <div className="sticky left-0 mb-2 flex w-fit flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                      Gen {row.generation}
                    </span>
                    <span className="text-[12px] tabular-nums text-zinc-400">
                      {row.nodes.length} {row.nodes.length === 1 ? "variant" : "variants"}
                    </span>
                    {row.winner && row.winner.arm.impressions ? (
                      <>
                        <span aria-hidden="true" className="h-3 w-px self-center bg-white/12" />
                        <span className="text-[12px] tabular-nums text-zinc-300">
                          best {pct(winnerRate, 2)}
                        </span>
                      </>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-4 gap-2 sm:gap-3" style={sunk}>
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
                      <div
                        className={`sticky left-0 max-w-full rounded-full border bg-zinc-950 px-3 py-1.5 text-center ${
                          paidGenerations.has(row.generation)
                            ? "border-emerald-400/35"
                            : "border-white/12"
                        }`}
                      >
                        <p className="text-[11px] leading-snug text-zinc-300 sm:text-[12px]">
                          {paidGenerations.has(row.generation) ? (
                            <span className="font-semibold text-emerald-300">
                              Agent bought render credits
                            </span>
                          ) : (
                            <span className="font-semibold text-zinc-100">Nothing was charged</span>
                          )}
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
                  className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-4 text-center"
                >
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    Gen 1
                  </div>
                  <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-zinc-400">
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
