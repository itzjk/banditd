"use client";

import type { Insights as InsightsData } from "@/lib/store";
import AgentStatus from "@/components/AgentStatus";
import { plain, timeAgo } from "./format";

interface Props {
  insights: InsightsData | null;
  generation: number;
  impressions: number;
  hasResearch: boolean;
  hasTraffic: boolean;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}

const STEPS = [
  "Rereading the market research it pulled off the web",
  "Lining up the four click rates against the angles",
  "Marking the competitor angles nobody has tested",
  "Writing only what the numbers can carry",
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-3 sm:p-4">
      {children}
    </section>
  );
}

function Heading({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      {note ? <span className="text-[12px] text-zinc-400">{note}</span> : null}
    </div>
  );
}

function Sim() {
  return (
    <span className="shrink-0 rounded border border-white/12 px-1 py-px text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
      Sim
    </span>
  );
}

export default function Insights({
  insights,
  generation,
  impressions,
  hasResearch,
  hasTraffic,
  running,
  disabled,
  onRun,
}: Props) {
  const ready = hasResearch && hasTraffic;
  const stale =
    insights !== null &&
    (insights.generation !== generation || insights.impressions !== impressions);

  const blocked = !hasResearch
    ? "Run the market research first. These recommendations are built on the pages the search read, not on anything the model remembers."
    : "Serve traffic first. Until impressions land there are no click rates to reason from, and the agent would be guessing.";

  return (
    <Shell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              Read off this run
            </span>
            <Sim />
          </div>
          <p className="mt-2 max-w-xl break-words text-[13px] leading-relaxed text-zinc-400 [overflow-wrap:anywhere]">
            The agent takes the market research it gathered and the click rates it measured, and says
            what it would do next. It is told to invent no market numbers, and to answer &ldquo;no
            basis yet&rdquo; when the data cannot carry a claim.
          </p>
        </div>

        <button
          type="button"
          onClick={onRun}
          disabled={disabled || !ready}
          className="min-h-[2.75rem] w-full shrink-0 rounded-xl border border-white/25 bg-white/[0.08] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.15] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {running ? "Reading the run" : insights ? "Read it again" : "Recommend what to do next"}
        </button>
      </div>

      {running ? (
        <div className="mt-3">
          <AgentStatus title="Working out the recommendations" steps={STEPS} />
        </div>
      ) : null}

      {!insights && !running ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/12 bg-white/[0.02] p-4">
          <p className="break-words text-[14px] leading-relaxed text-zinc-300">
            {ready
              ? "Nothing written yet. The research is in and traffic has landed, so the agent has everything it needs the moment you ask."
              : blocked}
          </p>
        </div>
      ) : null}

      {insights ? (
        <div className="mt-4 space-y-4">
          {stale ? (
            <p
              role="status"
              className="break-words rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[13px] leading-snug text-amber-100"
            >
              The run moved on since this was written. It read generation {insights.generation} at{" "}
              {insights.impressions.toLocaleString()} impressions, and the board is on generation{" "}
              {generation} at {impressions.toLocaleString()}. Ask again for a current read.
            </p>
          ) : null}

          <div className="border-t border-white/10 pt-4">
            <Heading label="What the buyers told us" />
            <p className="mt-2 break-words text-[15px] leading-relaxed text-zinc-100 [overflow-wrap:anywhere]">
              {plain(insights.buyerLesson)}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] leading-snug text-zinc-400">
              <Sim />
              <span className="min-w-0 break-words">
                Read off simulated click rates. The {insights.winnerAngle} angle held the best one.
              </span>
            </p>
          </div>

          <div className="border-t border-white/10 pt-4">
            <Heading
              label="The play good sellers here use"
              note={
                insights.competitorPlays.length
                  ? `${insights.competitorPlays.length} untested`
                  : undefined
              }
            />
            {insights.competitorPlays.length ? (
              <ol className="mt-2 space-y-2">
                {insights.competitorPlays.map((p, i) => (
                  <li
                    key={`${p.play}-${i}`}
                    className="rounded-xl bg-white/[0.03] px-3 py-2.5"
                  >
                    <div className="flex gap-2.5">
                      <span className="mt-[3px] w-5 shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-[14px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">
                          {plain(p.play)}
                        </div>
                        <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
                          {plain(p.why)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 break-words text-[14px] leading-relaxed text-zinc-300">
                The search found no competitor angle this run has not already put on the board.
              </p>
            )}
            <p className="mt-2 break-words text-[12px] leading-snug text-zinc-400">
              Taken from the competitor angles the live search found, minus the angles already on the
              board.
            </p>
          </div>

          <div className="border-t border-white/10 pt-4">
            <Heading label="What to try next round" />
            {insights.nextTests.length ? (
              <ol className="mt-2 divide-y divide-white/[0.06]">
                {insights.nextTests.map((t, i) => (
                  <li key={`${t.idea}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="break-words text-[14px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">
                      {plain(t.idea)}
                    </div>
                    <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
                      {plain(t.why)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-[14px] leading-relaxed text-zinc-300">
                It put nothing forward for the next round.
              </p>
            )}
          </div>

          <div className="border-t border-white/10 pt-4">
            <Heading label="Product estimates" />
            {insights.estimates.length ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {insights.estimates.map((e, i) => (
                  <div
                    key={`${e.label}-${i}`}
                    className="min-w-0 rounded-xl bg-white/[0.03] px-3 py-2.5"
                  >
                    <div className="break-words text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [overflow-wrap:anywhere]">
                      {plain(e.label)}
                    </div>
                    <div className="mt-1 break-words text-[15px] font-semibold leading-snug tabular-nums text-white [overflow-wrap:anywhere]">
                      {plain(e.call)}
                    </div>
                    <p className="mt-1 break-words text-[12px] leading-relaxed text-zinc-400 [overflow-wrap:anywhere]">
                      {plain(e.basis)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[14px] leading-relaxed text-zinc-300">
                It found nothing it could estimate without guessing.
              </p>
            )}
          </div>

          <p className="break-words border-t border-white/10 pt-3 text-[12px] leading-relaxed text-zinc-400 [overflow-wrap:anywhere]">
            Written {timeAgo(insights.at)} from generation {insights.generation},{" "}
            {insights.impressions.toLocaleString()} simulated impressions, with{" "}
            {insights.winnerHeadline ? `"${plain(insights.winnerHeadline)}"` : "the leading ad"} in
            front. Impressions and click rates are simulated. The market lines come from the sources
            listed under Market research.
          </p>
        </div>
      ) : null}
    </Shell>
  );
}
