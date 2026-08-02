"use client";

import { useMemo, useState } from "react";
import type { Research } from "@/lib/store";
import { citedSegments, extractCitations, sentencesOf, type Citation } from "./format";

interface Props {
  research: Research | null;
  productName?: string | null;
}

interface SourceEntry {
  title: string;
  url: string;
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

  const sentences = sentencesOf(blocks[0] ?? "");

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
    <section className="rounded-2xl bg-white/[0.02] p-3 sm:p-4">{children}</section>
  );
}

function Marker({ citation, number, after }: { citation: Citation; number: number; after: boolean }) {
  return (
    <sup className="whitespace-nowrap text-[9px] font-semibold leading-none tabular-nums">
      {after ? <span className="text-zinc-400">,</span> : null}
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Source ${number}: ${domainOf(citation.url)}`}
        className="ml-px rounded-sm px-px text-zinc-200 underline decoration-white/40 underline-offset-2 transition-colors hover:text-white hover:decoration-white"
      >
        {number}
      </a>
    </sup>
  );
}

function Cited({
  value,
  citations,
  numberOf,
}: {
  value: string;
  citations: Citation[];
  numberOf: (url: string) => number;
}) {
  const segments = useMemo(() => citedSegments(value), [value]);

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === "text") return <span key={i}>{segment.value}</span>;
        const citation = citations[segment.index];
        if (!citation) return null;
        return (
          <Marker
            key={i}
            citation={citation}
            number={numberOf(citation.url)}
            after={segments[i - 1]?.kind === "cite"}
          />
        );
      })}
    </>
  );
}

export default function MarketPanel({ research, productName }: Props) {
  const [allAngles, setAllAngles] = useState(false);
  const [allSources, setAllSources] = useState(false);

  const parsed = useMemo(() => {
    const profile = extractCitations(research?.buyerProfile ?? "");
    const price = extractCitations(research?.pricePositioning ?? "");
    const angles = (research?.competitorAngles ?? [])
      .map((a) => extractCitations(a.trim()))
      .filter((a) => a.text.length > 0);
    return { profile, price, angles };
  }, [research]);

  const registry = useMemo(() => {
    const number = new Map<string, number>();
    const entries: SourceEntry[] = [];

    const add = (title: string, url: string) => {
      if (!url || number.has(url)) return;
      number.set(url, entries.length + 1);
      entries.push({ title: title.trim(), url });
    };

    for (const source of research?.sources ?? []) add(source.title ?? "", source.url ?? "");
    for (const citation of [
      ...parsed.profile.citations,
      ...parsed.angles.flatMap((a) => a.citations),
      ...parsed.price.citations,
    ]) {
      add(citation.label, citation.url);
    }

    return { entries, numberOf: (url: string) => number.get(url) ?? 0 };
  }, [research, parsed]);

  const sources = registry.entries;
  const domains = useMemo(() => new Set(sources.map((s) => domainOf(s.url))).size, [sources]);
  const profile = useMemo(() => paragraphs(parsed.profile.text), [parsed]);

  if (!research) {
    return (
      <Shell>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Not run yet
          </span>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-zinc-400">
          Run the research and this fills with who buys it, the angles competitors run, where your
          price lands, and every live source the agent read.
        </p>
      </Shell>
    );
  }

  const angles = parsed.angles;
  const shownAngles = allAngles ? angles : angles.slice(0, ANGLES_SHOWN);
  const shownSources = allSources ? sources : sources.slice(0, SOURCES_SHOWN);

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="break-words text-[12px] leading-snug text-zinc-400 [overflow-wrap:anywhere]">
            {productName ? `Evidence behind the ads for ${productName}` : "Evidence behind the ads"}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-300 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-zinc-200" />
          </span>
          Live web search
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="min-w-0 rounded-xl bg-white/[0.03] px-2.5 py-2">
          <div className="text-base font-semibold tabular-nums leading-none text-white">
            {sources.length}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
            Sources read
          </div>
        </div>
        <div className="min-w-0 rounded-xl bg-white/[0.03] px-2.5 py-2">
          <div className="text-base font-semibold tabular-nums leading-none text-white">
            {domains}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-400">Sites</div>
        </div>
        <div className="min-w-0 rounded-xl bg-white/[0.03] px-2.5 py-2">
          <div className="text-base font-semibold tabular-nums leading-none text-white">
            {angles.length}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-400">Angles</div>
        </div>
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
        Pulled from pages fetched during this run, not from model memory. Numbers in the text link to
        the source they came from.
      </p>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Who buys this
        </div>
        {profile.length ? (
          <div className="mt-2 space-y-2">
            {profile.map((block, i) => (
              <p
                key={i}
                className={`break-words leading-relaxed [overflow-wrap:anywhere] ${
                  i === 0 ? "text-[15px] text-zinc-100" : "text-[14px] text-zinc-400"
                }`}
              >
                <Cited
                  value={block}
                  citations={parsed.profile.citations}
                  numberOf={registry.numberOf}
                />
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-zinc-400">No buyer profile came back.</p>
        )}
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            What competitors say
          </div>
          <span className="text-[12px] tabular-nums text-zinc-400">
            {angles.length} {angles.length === 1 ? "angle" : "angles"} found
          </span>
        </div>

        {angles.length ? (
          <>
            <ol className="mt-2 divide-y divide-white/[0.06]">
              {shownAngles.map((angle, i) => (
                <li key={`${angle.text}-${i}`} className="flex gap-2.5 py-2 first:pt-0 last:pb-0">
                  <span className="mt-[3px] w-5 shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[14px] leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
                    <Cited
                      value={angle.text}
                      citations={angle.citations}
                      numberOf={registry.numberOf}
                    />
                  </span>
                </li>
              ))}
            </ol>
            {angles.length > ANGLES_SHOWN ? (
              <button
                type="button"
                aria-expanded={allAngles}
                onClick={() => setAllAngles((v) => !v)}
                className="mt-2 min-h-[2.75rem] w-full cursor-pointer rounded-xl bg-white/[0.03] px-3 text-[14px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07]"
              >
                {allAngles ? "Show fewer" : `Show all ${angles.length}`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[14px] text-zinc-400">No competitor angles came back.</p>
        )}
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Where your price lands
        </div>
        {parsed.price.text ? (
          <div className="mt-2 rounded-xl bg-white/[0.04] p-3">
            <p className="break-words text-[14px] leading-relaxed text-zinc-100 [overflow-wrap:anywhere]">
              <Cited
                value={parsed.price.text}
                citations={parsed.price.citations}
                numberOf={registry.numberOf}
              />
            </p>
            <p className="mt-2 text-[12px] leading-snug text-zinc-400">
              This is the claim the price angle ads argue from.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-zinc-400">No price positioning came back.</p>
        )}
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Sources
          </div>
          <span className="text-[12px] tabular-nums text-zinc-400">
            {sources.length} read across {domains} {domains === 1 ? "site" : "sites"}
          </span>
        </div>

        {sources.length ? (
          <>
            <ol className="mt-2 space-y-1.5">
              {shownSources.map((source) => {
                const domain = domainOf(source.url);
                const path = pathOf(source.url);
                return (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2.5 rounded-xl bg-white/[0.03] px-2.5 py-2 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
                    >
                      <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] font-mono text-[10px] tabular-nums text-zinc-400 group-hover:text-zinc-200">
                        {registry.numberOf(source.url)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[14px] leading-snug text-zinc-200 group-hover:text-white [overflow-wrap:anywhere]">
                          {source.title || domain}
                        </span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1">
                          <span className="min-w-0 break-all font-mono text-[12px] text-zinc-400">
                            {domain}
                          </span>
                          {path ? (
                            <span className="min-w-0 truncate font-mono text-[12px] text-zinc-400">
                              {path}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-[1px] shrink-0 text-[13px] text-zinc-400 group-hover:text-zinc-200"
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
                className="mt-2 min-h-[2.75rem] w-full cursor-pointer rounded-xl bg-white/[0.03] px-3 text-[14px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.07]"
              >
                {allSources ? "Show fewer" : `Show all ${sources.length} sources`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[14px] text-zinc-400">
            The search returned no citable sources on this run.
          </p>
        )}
      </div>
    </Shell>
  );
}
