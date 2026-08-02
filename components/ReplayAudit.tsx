"use client";

import { useEffect, useMemo, useState } from "react";
import type { Creative, Round } from "@/lib/store";
import { pct } from "./format";
import {
  REPLAY_SAMPLES,
  replayRun,
  verdictOf,
  type Replay,
  type ReplayCreative,
  type Verdict,
} from "./replay-audit";

interface Props {
  rounds: Round[];
  creatives: Creative[];
  headingLevel?: 2 | 3;
}

const TONE = {
  caught: {
    edge: "border-emerald-400/35",
    tint: "bg-emerald-400/[0.06]",
    label: "text-emerald-300",
    text: "False winner caught",
  },
  agreed: {
    edge: "border-white/12",
    tint: "bg-white/[0.03]",
    label: "text-zinc-300",
    text: "Both rules agreed",
  },
  against: {
    edge: "border-amber-400/35",
    tint: "bg-amber-400/[0.06]",
    label: "text-amber-200",
    text: "This one goes against us",
  },
  open: {
    edge: "border-white/12",
    tint: "bg-white/[0.03]",
    label: "text-zinc-300",
    text: "Nothing separates them",
  },
} as const;

function shown(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function label(cohort: Creative[], index: number): string {
  const c = cohort[index];
  if (!c) return "variant";
  const twin = cohort.filter((other, i) => i < index && other.angle === c.angle).length;
  return twin > 0 ? `${c.angle} ${twin + 1}` : c.angle;
}

function idle(task: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(() => task(), { timeout: 400 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, 0);
  return () => window.clearTimeout(handle);
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full border border-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
      {children}
    </span>
  );
}

function Shell({
  headingLevel,
  looks,
  older,
  generation,
  children,
}: {
  headingLevel: 2 | 3;
  looks: number | null;
  older?: boolean;
  generation?: number;
  children: React.ReactNode;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const size = headingLevel === 2 ? "t-title" : "t-small font-semibold";
  return (
    <section
      aria-label="The common rule replayed on this run"
      className="overflow-hidden rounded-2xl bg-white/[0.02]"
    >
      <div className="border-b border-white/10 px-3 py-3 sm:px-4 sm:py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <Heading className={`${size} break-words text-white`}>
              The rule everyone else uses, replayed on this run
            </Heading>
            <p className="mt-0.5 break-words text-[12px] leading-snug text-zinc-400">
              {looks === null
                ? "The agent grades itself against the rule most teams stop on."
                : `Both rules read the same ${looks} ${looks === 1 ? "look" : "looks"}${
                    older ? ` of generation ${generation}` : ""
                  } of this run. Only the moment they stop is different.`}
            </p>
          </div>
          <Chip>Simulated traffic</Chip>
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ headingLevel, note }: { headingLevel: 2 | 3; note: string }) {
  return (
    <Shell headingLevel={headingLevel} looks={null}>
      <div className="px-3 py-4 sm:px-4">
        <p className="break-words text-[13px] leading-relaxed text-zinc-400">{note}</p>
      </div>
    </Shell>
  );
}

function Column({
  title,
  rule,
  call,
  pick,
  fired,
  accent,
  headingLevel,
}: {
  title: string;
  rule: string;
  call: { look: number; served: number; probabilityBest: number; candidateImpressions: number } | null;
  pick: string | null;
  fired: string;
  accent: string;
  headingLevel: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h3" : "h4";
  return (
    <div className="bg-zinc-950">
      <div className={`h-full border-l-2 px-3 py-3 sm:px-4 ${call ? accent : "border-white/10"}`}>
        <div className="flex items-start justify-between gap-2">
          <Heading className="t-caption min-w-0 break-words font-semibold leading-snug text-zinc-100">
            {title}
          </Heading>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
              call
                ? "border-white/20 bg-white/[0.06] text-zinc-200"
                : "border-white/10 bg-white/5 text-zinc-400"
            }`}
          >
            {fired}
          </span>
        </div>

        <p className="mt-2.5 break-words text-[17px] font-semibold leading-tight text-white">
          {pick ?? "No winner called"}
        </p>

        {call ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
                Impressions served
              </dt>
              <dd className="truncate text-[14px] font-semibold tabular-nums text-zinc-100">
                {shown(call.served)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
                Sure it was best
              </dt>
              <dd className="truncate text-[14px] font-semibold tabular-nums text-zinc-100">
                {pct(call.probabilityBest)}
              </dd>
            </div>
          </dl>
        ) : null}

        <p className="mt-2.5 break-words text-[12px] leading-relaxed text-zinc-400">{rule}</p>
      </div>
    </div>
  );
}

function Track({ replay }: { replay: Replay }) {
  const total = replay.looks.length;
  const naiveLook = replay.naive?.look ?? null;
  const gatedLook = replay.gated?.look ?? null;

  return (
    <div className="px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
          Where the two rules separate
        </span>
        <span className="text-[12px] tabular-nums text-zinc-400">
          {total} {total === 1 ? "look" : "looks"}, {shown(replay.looks[total - 1].served)}{" "}
          impressions in total
        </span>
      </div>

      <ul
        className="mt-2 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {replay.looks.map((look) => {
          const naiveHit = naiveLook === look.n;
          const gatedHit = gatedLook === look.n;
          const naiveOn = naiveLook !== null && look.n >= naiveLook;
          const gatedOn = gatedLook !== null && look.n >= gatedLook;
          return (
            <li key={look.n} className="min-w-0">
              <span
                className={`block h-1.5 rounded-full ${
                  naiveHit ? "bg-amber-400" : naiveOn ? "bg-amber-400/25" : "bg-white/10"
                }`}
              />
              <span
                className={`mt-1 block h-1.5 rounded-full ${
                  gatedHit ? "bg-emerald-400" : gatedOn ? "bg-emerald-400/25" : "bg-white/10"
                }`}
              />
              <span className="mt-1 block truncate text-center text-[10px] tabular-nums text-zinc-500">
                {look.n}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-3 rounded-full bg-amber-400" />
          The common rule
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-3 rounded-full bg-emerald-400" />
          banditd
        </span>
        <span className="tabular-nums">look numbers along the bottom</span>
      </div>
    </div>
  );
}

function Aftermath({ replay }: { replay: Replay }) {
  const naivePick = replay.naive ? replay.arms[replay.naive.candidate] : null;
  const gatedPick = replay.gated ? replay.arms[replay.gated.candidate] : null;
  if (!naivePick || !gatedPick || naivePick.id === gatedPick.id) return null;

  const rows = [
    { tag: "The common rule picked", arm: naivePick, tone: "text-amber-200" },
    { tag: "banditd picked", arm: gatedPick, tone: "text-emerald-300" },
  ];

  return (
    <div className="border-t border-white/10 px-3 py-3 sm:px-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
        What the two picks did by the last look
      </p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li
            key={row.arm.id}
            className="min-w-0 rounded-xl bg-white/[0.03] px-3 py-2.5"
          >
            <p className="truncate text-[11px] text-zinc-400">{row.tag}</p>
            <p className="mt-0.5 truncate text-[14px] font-semibold text-white">{row.arm.label}</p>
            <p className={`mt-1 text-[17px] font-semibold tabular-nums ${row.tone}`}>
              {pct(row.arm.rate, 2)}
            </p>
            <p className="mt-0.5 truncate text-[11px] tabular-nums text-zinc-400">
              {shown(row.arm.clicks)} clicks on {shown(row.arm.impressions)} impressions
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 break-words text-[12px] leading-relaxed text-zinc-400">
        The common rule would have ended the test at its own call. This run did not, so the two
        numbers above are what each pick went on doing with the traffic the run actually served it.
      </p>
    </div>
  );
}

export default function ReplayAudit({ rounds, creatives, headingLevel = 2 }: Props) {
  const cohorts = useMemo(() => {
    const byGeneration = new Map<number, Creative[]>();
    for (const c of creatives) {
      const kept = byGeneration.get(c.generation) ?? [];
      kept.push(c);
      byGeneration.set(c.generation, kept);
    }
    return [...byGeneration.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([generation, list]) => ({
        generation,
        seats: list.map((c, i) => ({ id: c.id, label: label(list, i) })) as ReplayCreative[],
      }));
  }, [creatives]);

  const newest = cohorts[0]?.generation ?? 0;

  const signature = useMemo(
    () =>
      `${cohorts.map((c) => `${c.generation}:${c.seats.map((s) => s.id).join(",")}`).join("|")}#${rounds
        .map((r) => `${r.generation}=${r.arms.map((a) => `${a.impressions}:${a.clicks}`).join("/")}`)
        .join(";")}`,
    [rounds, cohorts],
  );

  const [done, setDone] = useState<{ sig: string; replay: Replay } | null>(null);

  useEffect(() => {
    if (done?.sig === signature) return;
    return idle(() => {
      let chosen: Replay | null = null;
      for (const c of cohorts) {
        const attempt = replayRun(rounds, c.seats, c.generation);
        if (!chosen) chosen = attempt;
        if (attempt.status === "ready") {
          chosen = attempt;
          break;
        }
      }
      setDone({
        sig: signature,
        replay: chosen ?? replayRun(rounds, [], newest),
      });
    });
  }, [signature, rounds, cohorts, newest, done]);

  const replay = done?.sig === signature ? done.replay : null;

  if (!replay) {
    return (
      <Empty
        headingLevel={headingLevel}
        note="Reading this run's looks back through both rules."
      />
    );
  }

  if (replay.status !== "ready") {
    return (
      <Empty
        headingLevel={headingLevel}
        note="This needs a run with at least two looks behind it. Serve traffic twice, or press Run the full demo, and the agent grades itself against the common rule here."
      />
    );
  }

  const verdict: Verdict = verdictOf(replay);
  const tone = TONE[verdict.tone];
  const naivePick = replay.naive ? replay.arms[replay.naive.candidate] : null;
  const gatedPick = replay.gated ? replay.arms[replay.gated.candidate] : null;

  return (
    <Shell
      headingLevel={headingLevel}
      looks={replay.looks.length}
      older={replay.generation !== newest}
      generation={replay.generation}
    >
      <div className="px-3 py-3 sm:px-4">
        <div className={`rounded-xl border px-3 py-2.5 ${tone.edge} ${tone.tint}`}>
          <p
            className={`text-[11px] font-bold uppercase tracking-[0.14em] ${tone.label}`}
          >
            {tone.text}
          </p>
          <p className="mt-1 break-words text-[14px] font-medium leading-relaxed text-zinc-100">
            {verdict.headline}
          </p>
          <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-400">
            {verdict.detail}
          </p>
        </div>
      </div>

      <ul className="grid list-none gap-px bg-white/[0.07] sm:grid-cols-2">
        <li>
          <Column
            headingLevel={headingLevel}
            title="The common rule"
            rule="Stops at the first look where one ad passes 95% likely to be best, with at least 200 impressions on it."
            call={replay.naive}
            pick={naivePick?.label ?? null}
            fired={replay.naive ? `Called on look ${replay.naive.look}` : "Never called"}
            accent="border-amber-400/60"
          />
        </li>
        <li>
          <Column
            headingLevel={headingLevel}
            title="banditd, four gates"
            rule="Adds a gap worth money and an anytime valid bound on top of that, so repeated looks cannot inflate it."
            call={replay.gated}
            pick={gatedPick?.label ?? null}
            fired={replay.gated ? `Called on look ${replay.gated.look}` : "Never called"}
            accent="border-emerald-400/60"
          />
        </li>
      </ul>

      <div className="border-t border-white/10">
        <Track replay={replay} />
      </div>

      <Aftermath replay={replay} />

      <p className="border-t border-white/10 px-3 py-3 text-[12px] leading-relaxed text-zinc-400 sm:px-4">
        The traffic in this run is simulated and every number above comes from it. The comparison is
        not simulated: both rules are replayed on the impressions and clicks this run actually
        recorded, at every look it actually took, off one evaluation of {shown(REPLAY_SAMPLES)}{" "}
        posterior draws per look. Neither rule was given numbers the other did not see.
        {replay.truncated ? " Only the first looks of a longer run are replayed here." : ""}
      </p>
    </Shell>
  );
}
