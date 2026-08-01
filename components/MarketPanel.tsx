"use client";

import { useMemo, useState } from "react";
import type { Research } from "@/lib/store";

interface Props {
  research: Research | null;
  productName?: string | null;
}

const ANGLES_SHOWN = 4;
const SOURCES_SHOWN = 5;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || url;
  }
}

function pathOf(url: string): string {
  try {
    const { pathname } = new URL(url);
    return pathname === "/" ? "" : pathname;
  } catch {
    return "";
  }
}

function paragraphs(value: string): string[] {
  const blocks = value
    .split(/\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length > 1) return blocks;

  const sentences = (blocks[0] ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length < 3) return sentences.length ? [sentences.join(" ")] : [];

  const out: string[] = [];
  out.push(sentences[0]);
  for (let i = 1; i < sentences.length; i += 2) {
    out.push(sentences.slice(i, i + 2).join(" "));
  }
  return out;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">{children}</section>
  );
}

export default function MarketPanel({ research, productName }: Props) {
  const [allAngles, setAllAngles] = useState(false);
  const [allSources, setAllSources] = useState(false);

  const angles = useMemo(
    () => (research?.competitorAngles ?? []).map((a) => a.trim()).filter(Boolean),
    [research],
  );

  const sources = useMemo(() => {
    const seen = new Set<string>();
    return (research?.sources ?? []).filter((s) => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });
  }, [research]);

  const domains = useMemo(() => new Set(sources.map((s) => domainOf(s.url))).size, [sources]);

  const profile = useMemo(() => paragraphs(research?.buyerProfile ?? ""), [research]);

  if (!research) {
    return (
      <Shell>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold tracking-tight text-white">Market research</h2>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Not run yet
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">
          Run the research and this fills with who buys it, the angles competitors run, where your
          price lands, and every live source the agent read.
        </p>
      </Shell>
    );
  }

  const shownAngles = allAngles ? angles : angles.slice(0, ANGLES_SHOWN);
  const shownSources = allSources ? sources : sources.slice(0, SOURCES_SHOWN);

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-white">Market research</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            {productName ? `Evidence behind the ads for ${productName}` : "Evidence behind the ads"}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          Live web search
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
          <div className="text-base font-semibold tabular-nums leading-none text-white">
            {sources.length}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-zinc-500">
            Sources read
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
          <div className="text-base font-semibold tabular-nums leading-none text-white">
            {domains}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-zinc-500">Sites</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
          <div className="text-base font-semibold tabular-nums leading-none text-white">
            {angles.length}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-zinc-500">Angles</div>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Pulled from pages fetched during this run, not from model memory.
      </p>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Who buys this
        </div>
        {profile.length ? (
          <div className="mt-2 space-y-2">
            {profile.map((block, i) => (
              <p
                key={i}
                className={`break-words leading-relaxed ${
                  i === 0 ? "text-[14px] text-zinc-100" : "text-[13px] text-zinc-400"
                }`}
              >
                {block}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-zinc-500">No buyer profile came back.</p>
        )}
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            What competitors say
          </div>
          <span className="text-[11px] tabular-nums text-zinc-500">
            {angles.length} {angles.length === 1 ? "angle" : "angles"} found
          </span>
        </div>

        {angles.length ? (
          <>
            <ol className="mt-2 divide-y divide-white/[0.06]">
              {shownAngles.map((angle, i) => (
                <li key={`${angle}-${i}`} className="flex gap-2.5 py-2 first:pt-0 last:pb-0">
                  <span className="mt-[3px] w-5 shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[13px] leading-relaxed text-zinc-300">
                    {angle}
                  </span>
                </li>
              ))}
            </ol>
            {angles.length > ANGLES_SHOWN ? (
              <button
                type="button"
                aria-expanded={allAngles}
                onClick={() => setAllAngles((v) => !v)}
                className="mt-2 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07]"
              >
                {allAngles ? "Show fewer" : `Show all ${angles.length}`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[13px] text-zinc-500">No competitor angles came back.</p>
        )}
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Where your price lands
        </div>
        {research.pricePositioning ? (
          <div className="mt-2 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-3">
            <p className="break-words text-[14px] leading-relaxed text-zinc-100">
              {research.pricePositioning}
            </p>
            <p className="mt-2 text-[11px] leading-snug text-emerald-300/80">
              This is the claim the price angle ads argue from.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-zinc-500">No price positioning came back.</p>
        )}
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Sources
          </div>
          <span className="text-[11px] tabular-nums text-zinc-500">
            {sources.length} read across {domains} {domains === 1 ? "site" : "sites"}
          </span>
        </div>

        {sources.length ? (
          <>
            <ol className="mt-2 space-y-1.5">
              {shownSources.map((source, i) => {
                const domain = domainOf(source.url);
                const path = pathOf(source.url);
                return (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
                    >
                      <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] font-mono text-[10px] uppercase text-zinc-400">
                        {domain.charAt(0) || String(i + 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[13px] leading-snug text-zinc-200 group-hover:text-white">
                          {source.title || domain}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-baseline gap-1">
                          <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                            {domain}
                          </span>
                          {path ? (
                            <span className="min-w-0 truncate font-mono text-[11px] text-zinc-600">
                              {path}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-[1px] shrink-0 text-[11px] text-zinc-600 group-hover:text-zinc-300"
                      >
                        ↗
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
            {sources.length > SOURCES_SHOWN ? (
              <button
                type="button"
                aria-expanded={allSources}
                onClick={() => setAllSources((v) => !v)}
                className="mt-2 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07]"
              >
                {allSources ? "Show fewer" : `Show all ${sources.length} sources`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[13px] text-zinc-500">
            The search returned no citable sources on this run.
          </p>
        )}
      </div>
    </Shell>
  );
}
