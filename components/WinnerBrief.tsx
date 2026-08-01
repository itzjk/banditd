"use client";

import { useMemo, type ReactNode } from "react";
import type { Creative, CreativeAngle } from "@/lib/store";
import { createRng, evaluate } from "@/lib/bandit";
import { ctr, pct } from "./format";

export interface BriefEvaluation {
  candidateIndex?: number;
  candidateId?: string | null;
  probabilityBest?: number;
  sufficientEvidence?: boolean;
  totalImpressions?: number;
  expectedLoss?: number;
  posteriorMean?: number;
}

interface Props {
  cohort: Creative[];
  evaluation?: BriefEvaluation | null;
  winnerId?: string | null;
  seed?: number;
}

const ANGLE_MEANING: Record<CreativeAngle, string> = {
  price: "leads on what it costs",
  ritual: "leads on the habit around it",
  gift: "leads on giving it to someone",
  quality: "leads on how well it is made",
};

const SAMPLES = 4000;

function Simulated() {
  return (
    <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
      Simulated traffic
    </span>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Winner brief"
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
    >
      {children}
    </section>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="border-b border-white/10 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight text-white">Why this ad won</h3>
        <Simulated />
      </div>
      <p className="mt-0.5 break-words text-[12px] leading-relaxed text-zinc-400">{subtitle}</p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
        {label}
      </div>
      <div className="mt-0.5 break-words text-base font-semibold tabular-nums text-zinc-100">
        {value}
      </div>
      <p className="mt-0.5 break-words text-[11px] leading-relaxed text-zinc-400">{hint}</p>
    </div>
  );
}

export default function WinnerBrief({ cohort, evaluation, winnerId, seed = 7 }: Props) {
  const local = useMemo(() => {
    if (cohort.length === 0) return null;
    return evaluate(
      cohort.map((c) => c.arm),
      { samples: SAMPLES, candidateRule: "probabilityBest", rng: createRng(seed) },
    );
  }, [cohort, seed]);

  const served = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);

  if (cohort.length === 0 || served === 0) {
    return (
      <Shell>
        <Header subtitle="No traffic yet, so no ad has earned the title." />
        <div className="p-3 sm:p-4">
          <p className="text-[13px] leading-relaxed text-zinc-400">
            Once impressions land on the cohort, this panel names the leader, shows the gap to the
            ad behind it, and says in plain words what separates them.
          </p>
        </div>
      </Shell>
    );
  }

  const byCtr = [...cohort].sort(
    (a, b) => ctr(b.arm.impressions, b.arm.clicks) - ctr(a.arm.impressions, a.arm.clicks),
  );

  const named = winnerId ? cohort.find((c) => c.id === winnerId) : undefined;
  const fromEvaluation =
    evaluation?.candidateId != null
      ? cohort.find((c) => c.id === evaluation.candidateId)
      : typeof evaluation?.candidateIndex === "number"
        ? cohort[evaluation.candidateIndex]
        : undefined;
  const fromLocal = local && local.candidateIndex >= 0 ? cohort[local.candidateIndex] : undefined;
  const winner = named ?? fromEvaluation ?? fromLocal ?? byCtr[0];

  const rest = byCtr.filter((c) => c.id !== winner.id);
  const runnerUp = rest[0] ?? null;

  const winnerCtr = ctr(winner.arm.impressions, winner.arm.clicks);
  const runnerCtr = runnerUp ? ctr(runnerUp.arm.impressions, runnerUp.arm.clicks) : 0;
  const points = (winnerCtr - runnerCtr) * 100;
  const lift = runnerCtr > 0 ? (winnerCtr - runnerCtr) / runnerCtr : null;

  const probability = evaluation?.probabilityBest ?? local?.probabilityBest ?? 0;
  const settled = evaluation?.sufficientEvidence ?? local?.sufficientEvidence ?? false;
  const topCtr = Math.max(winnerCtr, ...cohort.map((c) => ctr(c.arm.impressions, c.arm.clicks)));

  const gap =
    runnerUp === null
      ? "It is the only ad with traffic in this generation, so there is nothing to compare it against yet."
      : winner.angle === runnerUp.angle
        ? `Both ads work the same angle, so the split is in the wording: "${winner.headline}" pulls ${points >= 0 ? points.toFixed(2) : (0).toFixed(2)} more clicks per hundred impressions than "${runnerUp.headline}".`
        : `The winner ${ANGLE_MEANING[winner.angle]}, the runner up ${ANGLE_MEANING[runnerUp.angle]}. On this audience the first framing pulls ${points >= 0 ? points.toFixed(2) : (0).toFixed(2)} more clicks per hundred impressions.`;

  const verdict = settled
    ? "The four gates agree the lead is real, not noise, so the agent is cleared to spend on it."
    : "The lead is not settled yet. The agent keeps serving traffic before it puts money behind this ad.";

  return (
    <Shell>
      <Header subtitle={`Generation ${winner.generation}, ${cohort.length} ads, ${served.toLocaleString()} impressions served.`} />

      <div className="space-y-3 p-3 sm:p-4">
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
              Winner
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
              {winner.angle}
            </span>
          </div>
          <h4 className="mt-2 break-words text-base font-semibold leading-snug text-white sm:text-lg">
            {winner.headline}
          </h4>
          {winner.body ? (
            <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-300">
              {winner.body}
            </p>
          ) : null}
          {winner.targetEmotion ? (
            <p className="mt-2 break-words text-[11px] leading-relaxed text-zinc-400">
              It is written to land on {winner.targetEmotion.toLowerCase()}, and it {ANGLE_MEANING[winner.angle]}.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Its CTR"
            value={pct(winnerCtr, 2)}
            hint={`${winner.arm.clicks.toLocaleString()} clicks on ${winner.arm.impressions.toLocaleString()} impressions`}
          />
          <Stat
            label="Over second"
            value={lift === null ? "n/a" : `${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(1)}%`}
            hint={`${points >= 0 ? "+" : ""}${points.toFixed(2)} points of CTR`}
          />
          <Stat
            label="Backing it"
            value={winner.arm.impressions.toLocaleString()}
            hint="Impressions on this ad alone, not the cohort"
          />
          <Stat
            label="Probability best"
            value={pct(probability)}
            hint={settled ? "Evidence settled" : "Still gathering"}
          />
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            The field
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {byCtr.map((c) => {
              const rate = ctr(c.arm.impressions, c.arm.clicks);
              const width = topCtr > 0 ? Math.max(0.02, rate / topCtr) : 0;
              const isWinner = c.id === winner.id;
              const isRunner = runnerUp !== null && c.id === runnerUp.id;
              return (
                <li key={c.id} className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <span className="min-w-0 flex-1 break-words text-[12px] leading-snug text-zinc-300">
                      {c.headline}
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold tabular-nums text-zinc-100">
                      {pct(rate, 2)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`bar-fill h-full w-full ${
                          isWinner ? "bg-emerald-400" : isRunner ? "bg-sky-400" : "bg-zinc-600"
                        }`}
                        style={{ transform: `scaleX(${width})` }}
                      />
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
                      {isWinner ? "winner" : isRunner ? "second" : c.angle}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            What separates it from second
          </div>
          <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-200">{gap}</p>
          <p className="mt-1.5 break-words text-[12px] leading-relaxed text-zinc-400">{verdict}</p>
        </div>
      </div>
    </Shell>
  );
}
