"use client";

import { useId, useState } from "react";
import type { Creative, PurchaseEvent } from "@/lib/store";
import { ctr, money, pct, toNumber } from "./format";

const RAMP = ["var(--curve-1)", "var(--curve-2)", "var(--curve-3)", "var(--curve-4)"];

type Source = "sim" | "sandbox" | "mixed";

interface Confidence {
  probabilityBest: number;
  sufficientEvidence: boolean;
  candidateId?: string | null;
}

interface Props {
  cohort: Creative[];
  creatives: Creative[];
  purchases: PurchaseEvent[];
  cap: number;
  credits: number;
  evaluation: Confidence | null;
  winnerId: string | null;
  generation: number;
}

const TAG: Record<Source, string> = {
  sim: "Sim",
  sandbox: "Sandbox",
  mixed: "Mixed",
};

function Tag({ source }: { source: Source }) {
  return (
    <span className="shrink-0 rounded border border-white/15 px-1 py-px text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
      {TAG[source]}
    </span>
  );
}

function Tile({
  label,
  value,
  hint,
  source,
  dim,
}: {
  label: string;
  value: string;
  hint?: string;
  source?: Source;
  dim?: boolean;
}) {
  return (
    <div className="min-w-0 bg-zinc-950 px-3 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          {label}
        </span>
        {source ? <Tag source={source} /> : null}
      </div>
      <div
        className={`mt-1.5 break-words text-[19px] font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-[18px] ${
          dim ? "text-zinc-400" : "text-white"
        }`}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1 break-words text-[12px] leading-snug text-zinc-400 [overflow-wrap:anywhere]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function cost(value: number): string {
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`;
}

export default function CampaignMetrics({
  cohort,
  creatives,
  purchases,
  cap,
  credits,
  evaluation,
  winnerId,
  generation,
}: Props) {
  const [allTiles, setAllTiles] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [conversion, setConversion] = useState("");
  const [order, setOrder] = useState("");
  const [cpm, setCpm] = useState("");
  const fields = useId();

  if (creatives.length === 0) return null;

  const paid = purchases.filter((p) => p.ok);
  const spent = paid.reduce((sum, p) => sum + toNumber(p.amount), 0);
  const blocked = purchases.length - paid.length;
  const used = cap > 0 ? Math.min(1, spent / cap) : 0;

  const impressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const clicks = cohort.reduce((sum, c) => sum + c.arm.clicks, 0);
  const average = ctr(impressions, clicks);

  const scored = cohort.filter((c) => c.arm.impressions > 0);
  const leader = scored.length
    ? scored.reduce((best, c) =>
        ctr(c.arm.impressions, c.arm.clicks) > ctr(best.arm.impressions, best.arm.clicks) ? c : best,
      )
    : null;
  const candidate = winnerId ? (cohort.find((c) => c.id === winnerId) ?? null) : null;
  const winner = candidate ?? leader;
  const winnerIndex = winner ? cohort.findIndex((c) => c.id === winner.id) : -1;
  const winnerCtr = winner ? ctr(winner.arm.impressions, winner.arm.clicks) : 0;
  const lift = average > 0 && winnerCtr > 0 ? winnerCtr / average - 1 : null;

  const cpc = spent > 0 && clicks > 0 ? spent / clicks : null;
  const generations = new Set(creatives.map((c) => c.generation)).size;
  const twin = winner
    ? cohort.filter((c, i) => i < winnerIndex && c.angle === winner.angle).length
    : 0;

  const rate = Math.min(1, Math.max(0, toNumber(conversion) / 100));
  const perOrder = Math.max(0, toNumber(order));
  const perThousand = Math.max(0, toNumber(cpm));
  const orders = clicks * rate;
  const revenue = rate > 0 && perOrder > 0 ? orders * perOrder : null;
  const media = perThousand > 0 && impressions > 0 ? (impressions / 1000) * perThousand : null;
  const evenCpm = revenue !== null && impressions > 0 ? revenue / (impressions / 1000) : null;
  const roas = revenue !== null && media !== null && media > 0 ? revenue / media : null;

  return (
    <section className="rounded-2xl border border-white/12 bg-white/[0.03] p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-white sm:text-base">
            How the campaign is doing
          </h2>
          <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            Simulated traffic
          </span>
          <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            Sandbox spend
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${
              credits > 0
                ? "border-white/30 bg-white/[0.07] text-white"
                : "border-rose-400/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            Render credits: {credits}
          </span>
          <span className="text-[12px] tabular-nums text-zinc-400">
            Generation {generation}, {cohort.length} ads live
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/[0.08] sm:grid-cols-4">
        <Tile
          label="Impressions"
          value={impressions ? impressions.toLocaleString() : "None yet"}
          hint={impressions ? "served across the live ads" : "serve traffic to fill this in"}
          source="sim"
          dim={impressions === 0}
        />
        <Tile
          label="Average CTR"
          value={impressions ? pct(average, 2) : "No data"}
          hint={impressions ? `across ${cohort.length} live ads` : "needs traffic first"}
          source="sim"
          dim={impressions === 0}
        />
        <Tile
          label="Winner CTR"
          value={winner && winnerCtr > 0 ? pct(winnerCtr, 2) : "No winner yet"}
          hint={
            winner && lift !== null
              ? `${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(0)}% over the ${pct(
                  average,
                  2,
                )} average`
              : "the best ad shows up once traffic runs"
          }
          source="sim"
          dim={!winner || winnerCtr === 0}
        />
        <Tile
          label="Budget used"
          value={`$${money(spent)}`}
          hint={`of the $${money(cap)} cap, ${pct(used, 0)} used`}
          source="sandbox"
          dim={spent === 0}
        />

        <div className={`${allTiles ? "contents" : "hidden"} sm:contents`}>
          <Tile
            label="Clicks"
            value={impressions ? clicks.toLocaleString() : "None yet"}
            hint={
              impressions ? `on ${impressions.toLocaleString()} impressions` : "no traffic served"
            }
            source="sim"
            dim={impressions === 0}
          />
          <Tile
            label="Cost per click"
            value={cpc !== null ? cost(cpc) : "No spend yet"}
            hint={
              cpc !== null
                ? "sandbox spend over simulated clicks"
                : "nothing charged, so there is no cost to divide"
            }
            source={cpc !== null ? "mixed" : "sandbox"}
            dim={cpc === null}
          />
          <Tile
            label="Confidence"
            value={evaluation ? pct(evaluation.probabilityBest, 1) : "Not read yet"}
            hint={
              evaluation
                ? evaluation.sufficientEvidence
                  ? "chance this ad is the best, gates cleared"
                  : "chance this ad is the best, gates still open"
                : "run the decision step to read it"
            }
            source="sim"
            dim={!evaluation}
          />
          <Tile
            label="Generations"
            value={String(generations)}
            hint={`${creatives.length} variants tested, ${paid.length} paid, ${blocked} blocked`}
          />
        </div>
      </div>

      <button
        type="button"
        aria-expanded={allTiles}
        onClick={() => setAllTiles((v) => !v)}
        className="mt-2 flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[13px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.07] sm:hidden"
      >
        {allTiles ? "Show fewer numbers" : "Show 4 more numbers"}
      </button>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            ROAS
          </span>
          <span className="shrink-0 rounded border border-white/15 px-1 py-px text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
            {roas !== null ? "Your projection" : "Not measured"}
          </span>
        </div>
        <div
          className={`mt-1.5 break-words text-[19px] font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-[18px] ${
            roas !== null ? "text-white" : "text-zinc-400"
          }`}
        >
          {roas !== null ? `${roas.toFixed(2)}x` : "Nothing to divide"}
        </div>
        <p className="mt-1.5 break-words text-[12px] leading-relaxed text-zinc-400">
          ROAS is revenue divided by media spend, and this run has neither. It never sells anything,
          so there is no revenue, and its traffic is simulated, so no impression was ever paid for.
          The budget above is sandbox money for render credits, not media. Nothing here invents a
          conversion rate to fill the gap.
        </p>

        <button
          type="button"
          aria-expanded={projecting}
          onClick={() => setProjecting((v) => !v)}
          className="mt-2 flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[13px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.07]"
        >
          {projecting ? "Hide the projection" : "Project it with my own numbers"}
        </button>

        {projecting ? (
          <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="min-w-0">
                <label
                  htmlFor={`${fields}-conversion`}
                  className="block text-[12px] font-semibold text-zinc-200"
                >
                  Your conversion rate
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id={`${fields}-conversion`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.1"
                    value={conversion}
                    onChange={(e) => setConversion(e.target.value)}
                    className="min-h-[2.75rem] w-full min-w-0 rounded-lg border border-white/15 bg-white/[0.06] px-3 text-[14px] tabular-nums text-white outline-none focus:border-white/40"
                  />
                  <span className="shrink-0 text-[13px] text-zinc-300">%</span>
                </div>
                <p className="mt-1 break-words text-[11px] leading-snug text-zinc-400">
                  Clicks that turn into orders on your own store.
                </p>
              </div>

              <div className="min-w-0">
                <label
                  htmlFor={`${fields}-order`}
                  className="block text-[12px] font-semibold text-zinc-200"
                >
                  Your revenue per order
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="shrink-0 text-[13px] text-zinc-300">$</span>
                  <input
                    id={`${fields}-order`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={order}
                    onChange={(e) => setOrder(e.target.value)}
                    className="min-h-[2.75rem] w-full min-w-0 rounded-lg border border-white/15 bg-white/[0.06] px-3 text-[14px] tabular-nums text-white outline-none focus:border-white/40"
                  />
                </div>
                <p className="mt-1 break-words text-[11px] leading-snug text-zinc-400">
                  What you collect on one order, before your costs.
                </p>
              </div>

              <div className="min-w-0">
                <label
                  htmlFor={`${fields}-cpm`}
                  className="block text-[12px] font-semibold text-zinc-200"
                >
                  What you pay per 1,000 impressions
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="shrink-0 text-[13px] text-zinc-300">$</span>
                  <input
                    id={`${fields}-cpm`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={cpm}
                    onChange={(e) => setCpm(e.target.value)}
                    className="min-h-[2.75rem] w-full min-w-0 rounded-lg border border-white/15 bg-white/[0.06] px-3 text-[14px] tabular-nums text-white outline-none focus:border-white/40"
                  />
                </div>
                <p className="mt-1 break-words text-[11px] leading-snug text-zinc-400">
                  Your real media rate. This run pays nothing for traffic.
                </p>
              </div>
            </div>

            <p className="mt-3 break-words text-[12px] leading-relaxed text-zinc-300">
              {roas !== null && revenue !== null && media !== null
                ? `${pct(rate, 1)} of ${clicks.toLocaleString()} simulated clicks is ${Math.round(
                    orders,
                  ).toLocaleString()} orders at $${money(perOrder)}, so $${money(
                    revenue,
                  )} of revenue against $${money(media)} of media at your $${money(
                    perThousand,
                  )} rate over ${impressions.toLocaleString()} impressions. All three numbers are yours, so this is your projection and not a number this run measured.`
                : revenue !== null && evenCpm !== null
                  ? `Your two numbers turn this run's ${impressions.toLocaleString()} simulated impressions into $${money(
                      revenue,
                    )} of revenue, so you break even at $${money(
                      evenCpm,
                    )} per 1,000 impressions. Add what you actually pay and the ratio appears.`
                  : "Fill these in and the projection lands here. Nothing is filled in for you, and the numbers stay in this browser."}
            </p>
          </div>
        ) : null}
      </div>

      {winner ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: RAMP[Math.max(0, winnerIndex) % RAMP.length] }}
          />
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
            {candidate ? "Winning ad" : "Leading ad"}
          </span>
          <span className="shrink-0 text-[13px] font-semibold capitalize text-white">
            {winner.angle}
            {twin > 0 ? ` ${twin + 1}` : ""}
          </span>
          <span className="min-w-0 break-words text-[13px] leading-snug text-zinc-300 [overflow-wrap:anywhere]">
            {winner.headline}
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-zinc-400">
            {pct(winnerCtr, 2)} on {winner.arm.impressions.toLocaleString()} impressions
          </span>
        </div>
      ) : null}

      <p className="mt-2.5 break-words text-[12px] leading-relaxed text-zinc-400">
        Impressions, clicks, click through rates and confidence come from simulated traffic, not from
        a live ad platform. Budget used is real money moved through the Prava sandbox. Cost per click
        mixes the two: sandbox spend divided by simulated clicks. Render credits are the goods that
        money buys: every approved charge adds them, every image render burns one, and at zero the
        agent cannot render until it buys again.
      </p>
    </section>
  );
}
