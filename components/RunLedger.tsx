"use client";

import { useState, type ReactNode } from "react";
import type { AuditEntry, State } from "@/lib/store";
import { ctr, money, toNumber } from "./format";

export interface LedgerPricing {
  textInputPerMillion: number;
  textOutputPerMillion: number;
  imagePerRender: number;
}

export const DEFAULT_PRICING: LedgerPricing = {
  textInputPerMillion: 0.2,
  textOutputPerMillion: 1.2,
  imagePerRender: 0.01,
};

export const DEFAULT_MODELS = {
  search: "gpt-5.6-luna",
  text: "gpt-5.6-terra",
  image: "gpt-image-1-mini",
};

const SHAPE = {
  research: { input: 1400, output: 900 },
  creatives: { input: 1800, output: 1500 },
  decision: { input: 1300, output: 500 },
};

interface Props {
  state: State | null;
  pricing?: Partial<LedgerPricing>;
  models?: Partial<typeof DEFAULT_MODELS>;
}

interface Line {
  id: string;
  label: string;
  model: string;
  calls: number;
  detail: string;
  cost: number;
}

function Estimate() {
  return (
    <span className="shrink-0 rounded-full border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-300">
      Estimate
    </span>
  );
}

function Measured() {
  return (
    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
      Measured
    </span>
  );
}

function Simulated() {
  return (
    <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
      Simulated
    </span>
  );
}

function countKind(audit: AuditEntry[], kind: string): number {
  return audit.filter((entry) => entry.kind === kind).length;
}

function blankImages(audit: AuditEntry[]): number {
  let total = 0;
  for (const entry of audit) {
    if (entry.kind !== "creatives") continue;
    const found = entry.detail.match(/(\d+)\s+image\(s\) ran out/);
    if (found) total += Number(found[1]);
  }
  return total;
}

function tokenCost(
  calls: number,
  shape: { input: number; output: number },
  pricing: LedgerPricing,
): number {
  const input = (calls * shape.input * pricing.textInputPerMillion) / 1_000_000;
  const output = (calls * shape.output * pricing.textOutputPerMillion) / 1_000_000;
  return input + output;
}

function tokens(calls: number, shape: { input: number; output: number }): string {
  const total = calls * (shape.input + shape.output);
  return `${total.toLocaleString()} tokens`;
}

function fine(value: number): string {
  if (!Number.isFinite(value)) return "0.0000";
  if (value === 0) return "0.0000";
  return value < 0.01 ? value.toFixed(4) : value.toFixed(3);
}

function Tile({
  label,
  value,
  hint,
  tag,
  strong,
}: {
  label: string;
  value: string;
  hint: string;
  tag: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border p-3 ${
        strong ? "border-white/15 bg-white/[0.06]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          {label}
        </span>
        {tag}
      </div>
      <div
        className={`mt-1 break-words text-lg font-semibold tabular-nums ${
          strong ? "text-white" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
      <p className="mt-0.5 break-words text-[11px] leading-relaxed text-zinc-400">{hint}</p>
    </div>
  );
}

export default function RunLedger({ state, pricing, models }: Props) {
  const [open, setOpen] = useState(false);

  const rates: LedgerPricing = { ...DEFAULT_PRICING, ...pricing };
  const model = { ...DEFAULT_MODELS, ...models };

  const audit = state?.audit ?? [];
  const creatives = state?.creatives ?? [];
  const purchases = state?.purchases ?? [];

  const generations = creatives.length
    ? new Set(creatives.map((c) => c.generation)).size
    : 0;

  const researchCalls = countKind(audit, "research") || (state?.research ? 1 : 0);
  const creativeCalls = countKind(audit, "creatives") || generations;
  const decisionCalls = countKind(audit, "decision");
  const imageRenders = Math.max(0, creatives.length - blankImages(audit));

  const lines: Line[] = [
    {
      id: "research",
      label: "Market research",
      model: model.search,
      calls: researchCalls,
      detail: `${tokens(researchCalls, SHAPE.research)}, live web search included`,
      cost: tokenCost(researchCalls, SHAPE.research, rates),
    },
    {
      id: "creatives",
      label: "Creative writing",
      model: model.text,
      calls: creativeCalls,
      detail: `${tokens(creativeCalls, SHAPE.creatives)}, four variants per call`,
      cost: tokenCost(creativeCalls, SHAPE.creatives, rates),
    },
    {
      id: "images",
      label: "Ad images",
      model: model.image,
      calls: imageRenders,
      detail: `${imageRenders} render${imageRenders === 1 ? "" : "s"} at $${rates.imagePerRender.toFixed(2)}`,
      cost: imageRenders * rates.imagePerRender,
    },
    {
      id: "decision",
      label: "Spend decision",
      model: model.text,
      calls: decisionCalls,
      detail: `${tokens(decisionCalls, SHAPE.decision)}, one tool call offered`,
      cost: tokenCost(decisionCalls, SHAPE.decision, rates),
    },
  ];

  const modelCalls = lines.reduce((sum, line) => sum + line.calls, 0);
  const modelCost = lines.reduce((sum, line) => sum + line.cost, 0);

  const charged = purchases.filter((p) => p.ok).reduce((sum, p) => sum + toNumber(p.amount), 0);
  const blocked = purchases.filter((p) => !p.ok).length;
  const chargeCount = purchases.filter((p) => p.ok).length;
  const runCost = modelCost + charged;

  const generation = creatives.length ? Math.max(...creatives.map((c) => c.generation)) : 0;
  const cohort = creatives.filter((c) => c.generation === generation);
  const cohortImpressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const cohortClicks = cohort.reduce((sum, c) => sum + c.arm.clicks, 0);
  const servedAll =
    state?.simulatedImpressions || creatives.reduce((sum, c) => sum + c.arm.impressions, 0);

  const evenCtr = ctr(cohortImpressions, cohortClicks);
  const bestCtr = cohort.reduce(
    (max, c) => Math.max(max, ctr(c.arm.impressions, c.arm.clicks)),
    0,
  );
  const pointsWon = Math.max(0, (bestCtr - evenCtr) * 100);
  const costPerPoint = pointsWon > 0 ? runCost / pointsWon : null;

  const started = audit.length ? audit[audit.length - 1].at : null;

  return (
    <section
      aria-label="Run ledger"
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
    >
      <div className="border-b border-white/10 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-white">
              What this run cost
            </h3>
            <p className="mt-0.5 break-words text-[12px] leading-relaxed text-zinc-400">
              Every model call and every charge the agent made, priced at the published rates.
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Run total
            </div>
            <div className="text-xl font-semibold tabular-nums text-white">
              ${money(runCost)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 sm:p-4">
        <Tile
          label="Model calls"
          value={modelCalls.toLocaleString()}
          hint={`$${fine(modelCost)} of OpenAI usage across ${lines.filter((l) => l.calls > 0).length} step types`}
          tag={<Estimate />}
        />
        <Tile
          label="Charged"
          value={`$${money(charged)}`}
          hint={
            chargeCount
              ? `${chargeCount} charge${chargeCount === 1 ? "" : "s"} on the mandate, ${blocked} blocked`
              : blocked
                ? `Nothing spent, ${blocked} attempt${blocked === 1 ? "" : "s"} blocked by the mandate`
                : "The agent has not spent yet"
          }
          tag={<Measured />}
        />
        <Tile
          label="Impressions"
          value={servedAll.toLocaleString()}
          hint={`${cohortClicks.toLocaleString()} clicks, ${(evenCtr * 100).toFixed(2)}% CTR spread evenly`}
          tag={<Simulated />}
        />
        <Tile
          label="Cost per CTR point"
          value={costPerPoint === null ? "Not yet" : `$${money(costPerPoint)}`}
          hint={
            costPerPoint === null
              ? "Needs traffic before the winner is worth anything"
              : `${pointsWon.toFixed(2)} points won over an even split`
          }
          tag={<Estimate />}
          strong
        />
      </div>

      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[12px] font-medium text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
        >
          {open ? "Hide the line items" : "Show the line items"}
        </button>

        {open ? (
          <div className="mt-2 overflow-hidden rounded-xl border border-white/10">
            <ul className="divide-y divide-white/10">
              {lines.map((line) => (
                <li key={line.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <div className="break-words text-[13px] font-semibold text-zinc-100">
                      {line.label}
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[11px] text-zinc-500">
                      {line.model}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-zinc-400">
                    {line.calls} call{line.calls === 1 ? "" : "s"}, {line.detail}
                  </div>
                  <div className="shrink-0 text-[13px] font-semibold tabular-nums text-zinc-100">
                    ${fine(line.cost)}
                  </div>
                </li>
              ))}
              <li className="flex flex-wrap items-baseline justify-between gap-2 bg-white/[0.03] p-3">
                <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Mandate charges
                </span>
                <span className="text-[13px] font-semibold tabular-nums text-zinc-100">
                  ${money(charged)}
                </span>
              </li>
            </ul>
            <div className="border-t border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-zinc-400">
              <p>
                Call counts come from the agent log, so they are real. Token counts per call are
                averages for these prompts, not billed usage, so the OpenAI figure is an estimate.
                Text is priced at ${rates.textInputPerMillion.toFixed(2)} per million input tokens
                and ${rates.textOutputPerMillion.toFixed(2)} per million output tokens, images at $
                {rates.imagePerRender.toFixed(2)} each.
              </p>
              <p className="mt-1.5">
                Impressions, clicks and CTR come from the simulated traffic model, not from a live
                ad platform. Charges are real calls against the Prava sandbox.
                {started ? ` Run opened ${new Date(started).toLocaleString()}.` : ""}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
