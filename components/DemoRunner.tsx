"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Creative, State } from "@/lib/store";
import AgentStatus from "@/components/AgentStatus";
import { ctr, money, pct } from "@/components/format";

export type Task =
  | "load"
  | "research"
  | "creatives"
  | "evolve"
  | "simulate"
  | "decide"
  | "purchase"
  | "force";

export interface Decision {
  shouldBuy: boolean;
  amount: string | null;
  reason: string;
  abstainedBecause: string | null;
}

export interface Evaluation {
  candidateIndex: number;
  probabilityBest: number;
  sufficientEvidence: boolean;
  totalImpressions: number;
  generation?: number;
  candidateId?: string | null;
  expectedLoss?: number;
  eValue?: number;
  posteriorMean?: number;
  thresholdMet?: boolean;
  minImpressionsMet?: boolean;
  effectSizeOk?: boolean;
  anytimeValid?: boolean;
}

export interface LastPurchase {
  ok: boolean;
  amount: string;
  reason: string;
  errorCode?: string;
  message?: string;
  forced?: boolean;
  cardLast4?: string | null;
}

interface DecideResponse {
  decision: Decision;
  evaluation: Evaluation;
  state: State;
}

type PurchaseResponse = State & { lastPurchase?: LastPurchase };

export const AGENT_STEPS: Record<Task, { title: string; steps: string[] }> = {
  load: { title: "Waking up", steps: ["Reading the agent state"] },
  research: {
    title: "Researching the market",
    steps: [
      "Searching the web for who buys this",
      "Reading the angles competitors run",
      "Placing the price against comparable products",
      "Writing the buyer profile",
    ],
  },
  creatives: {
    title: "Writing creatives",
    steps: [
      "Picking 4 angles out of the research",
      "Writing headlines and body copy",
      "Rendering 4 images",
      "Loading every variant into the bandit",
    ],
  },
  evolve: {
    title: "Breeding the winner",
    steps: [
      "Taking the winning creative apart",
      "Writing 4 mutations of that angle",
      "Rendering the new images",
      "Opening generation two",
    ],
  },
  simulate: {
    title: "Serving traffic",
    steps: [
      "Opening the simulated auction",
      "Allocating impressions by Thompson sampling",
      "Counting clicks per variant",
      "Updating each posterior",
    ],
  },
  decide: {
    title: "Deciding whether to spend",
    steps: [
      "Drawing 20,000 samples from every posterior",
      "Ranking the variants by probability best",
      "Reading the mandate limits",
      "Asking the model to justify the spend",
    ],
  },
  purchase: {
    title: "Buying render credits",
    steps: [
      "Minting a single use card",
      "Charging the mandate",
      "Reporting the charge back to Prava",
    ],
  },
  force: {
    title: "Testing the guardrail",
    steps: [
      "Building a charge above the signed ceiling",
      "Sending it at the mandate on purpose",
      "Waiting for the refusal",
    ],
  },
};

const TIMEOUT: Record<string, number> = {
  research: 240000,
  creatives: 300000,
  simulate: 60000,
  decide: 240000,
  purchase: 120000,
};

const TOTAL_STEPS = 7;
const PATIENCE_AFTER = 20;

type Tone = "done" | "held" | "blocked";
type Status = "running" | Tone | "failed" | "cancelled";

interface Entry {
  id: string;
  task: Task;
  label: string;
  status: Status;
  detail: string;
  note?: string;
  startedAt: number;
  seconds?: number;
}

type EndingKind = "complete" | "held" | "blocked" | "failed" | "stopped";

interface Ending {
  kind: EndingKind;
  headline: string;
  text: string;
}

class Cancelled extends Error {}

interface Props {
  state: State | null;
  absorb: (next: State) => State;
  impressions: number;
  disabled: boolean;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onDecision: (decision: Decision | null, evaluation: Evaluation | null) => void;
  onReceipt: (receipt: LastPurchase | null) => void;
}

function cohortOf(input: State): Creative[] {
  if (input.creatives.length === 0) return [];
  const generation = Math.max(...input.creatives.map((c) => c.generation));
  return input.creatives.filter((c) => c.generation === generation);
}

function bestCtrOf(cohort: Creative[]): number {
  return cohort.reduce((max, c) => Math.max(max, ctr(c.arm.impressions, c.arm.clicks)), 0);
}

function leaderOf(cohort: Creative[]): Creative | null {
  const scored = cohort.filter((c) => c.arm.impressions > 0);
  if (scored.length === 0) return cohort[0] ?? null;
  return scored.reduce((best, c) =>
    ctr(c.arm.impressions, c.arm.clicks) > ctr(best.arm.impressions, best.arm.clicks) ? c : best,
  );
}

function blockingGate(evaluation: Evaluation): string | null {
  if (evaluation.minImpressionsMet === false) return "Enough traffic";
  if (evaluation.thresholdMet === false) return "One ad clearly ahead";
  if (evaluation.effectSizeOk === false) return "The gap is worth money";
  if (evaluation.anytimeValid === false) return "Holds up to repeated looks";
  return null;
}

function StatusDot({ status }: { status: Status }) {
  if (status === "running") {
    return (
      <span className="relative mt-0.5 flex h-3 w-3 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
      </span>
    );
  }

  const tone =
    status === "done"
      ? "border-emerald-400/50 bg-emerald-400/20 text-emerald-300"
      : status === "held"
        ? "border-amber-400/50 bg-amber-400/20 text-amber-300"
        : status === "blocked" || status === "failed"
          ? "border-rose-400/50 bg-rose-500/20 text-rose-300"
          : "border-white/15 bg-white/10 text-zinc-500";

  return (
    <span
      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${tone}`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-2.5 w-2.5">
        {status === "done" ? (
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M4 8h8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}

function TimelineRow({ entry }: { entry: Entry }) {
  const title =
    entry.status === "done"
      ? "text-zinc-100"
      : entry.status === "running"
        ? "text-white"
        : entry.status === "held"
          ? "text-amber-100"
          : entry.status === "blocked" || entry.status === "failed"
            ? "text-rose-100"
            : "text-zinc-400";

  return (
    <li className="flex gap-2.5 px-3 py-2 sm:px-4">
      <StatusDot status={entry.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-[13px] font-semibold ${title}`}>{entry.label}</span>
          {typeof entry.seconds === "number" ? (
            <span className="text-[10px] tabular-nums text-zinc-600">{entry.seconds}s</span>
          ) : null}
        </div>
        {entry.detail ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{entry.detail}</p>
        ) : null}
        {entry.note ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{entry.note}</p>
        ) : null}
      </div>
    </li>
  );
}

export default function DemoRunner({
  state,
  absorb,
  impressions,
  disabled,
  running,
  onRunningChange,
  onDecision,
  onReceipt,
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [waited, setWaited] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const seqRef = useRef(0);

  const active = entries.find((e) => e.status === "running") ?? null;
  const activeId = active?.id ?? null;

  useEffect(() => {
    if (!activeId) {
      setWaited(0);
      return;
    }
    setWaited(0);
    const timer = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(timer);
  }, [activeId]);

  const call = useCallback(
    async <T,>(url: string, body: unknown, ms: number, label: string): Promise<T> => {
      const controller = new AbortController();
      controllerRef.current = controller;
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        controller.abort();
      }, ms);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: controller.signal,
        });
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : `The server answered ${res.status} and gave no reason`;
          throw new Error(message);
        }
        return data as T;
      } catch (e) {
        if (cancelledRef.current) throw new Cancelled();
        if (expired) {
          throw new Error(
            `${label} ran past ${Math.round(ms / 1000)} seconds without answering. The server may still be finishing it, wait a moment and fire that step by hand from the manual controls.`,
          );
        }
        throw e instanceof Error ? e : new Error("The request never reached the server");
      } finally {
        clearTimeout(timer);
        controllerRef.current = null;
      }
    },
    [],
  );

  const step = useCallback(
    async (
      task: Task,
      label: string,
      work: () => Promise<{ detail: string; note?: string; tone?: Tone }>,
    ) => {
      seqRef.current += 1;
      const id = `step_${seqRef.current}`;
      const startedAt = Date.now();
      setEntries((prev) => [...prev, { id, task, label, status: "running", detail: "", startedAt }]);

      try {
        const out = await work();
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  status: out.tone ?? "done",
                  detail: out.detail,
                  note: out.note,
                  seconds: Math.round((Date.now() - startedAt) / 1000),
                }
              : e,
          ),
        );
      } catch (err) {
        const stopped = err instanceof Cancelled;
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  status: stopped ? "cancelled" : "failed",
                  detail: stopped
                    ? "Stopped by hand before this step came back"
                    : err instanceof Error
                      ? err.message
                      : "This step failed and gave no reason",
                  seconds: Math.round((Date.now() - startedAt) / 1000),
                }
              : e,
          ),
        );
        throw err;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    controllerRef.current?.abort();
  }, []);

  const start = useCallback(async () => {
    if (!state?.product) return;

    cancelledRef.current = false;
    setEntries([]);
    setEnding(null);
    onReceipt(null);
    onRunningChange(true);

    const guard = () => {
      if (cancelledRef.current) throw new Cancelled();
    };

    const held: {
      current: State;
      decision: Decision | null;
      evaluation: Evaluation | null;
      gate: string | null;
      bought: boolean;
      declined: string | null;
    } = {
      current: state,
      decision: null,
      evaluation: null,
      gate: null,
      bought: false,
      declined: null,
    };

    try {
      await step("research", "Research the market", async () => {
        const next = await call<State>(
          "/api/research",
          { state: held.current },
          TIMEOUT.research,
          "The market research",
        );
        held.current = absorb(next);
        const sources = held.current.research?.sources.length ?? 0;
        return {
          detail: sources
            ? `Read ${sources} live sources and wrote the buyer profile`
            : "Wrote the buyer profile off the live search",
        };
      });

      guard();

      await step("creatives", "Write four creatives", async () => {
        const next = await call<State>(
          "/api/creatives",
          { state: held.current },
          TIMEOUT.creatives,
          "The creative generation",
        );
        held.current = absorb(next);
        const cohort = cohortOf(held.current);
        return {
          detail: `Wrote ${cohort.length} ads with rendered images: ${cohort
            .map((c) => c.angle)
            .join(", ")}`,
        };
      });

      guard();

      await step("simulate", `Serve ${impressions.toLocaleString()} impressions`, async () => {
        const next = await call<State>(
          "/api/simulate",
          { impressions, state: held.current },
          TIMEOUT.simulate,
          "The traffic simulation",
        );
        held.current = absorb(next);
        const cohort = cohortOf(held.current);
        return {
          detail: `Served ${impressions.toLocaleString()} simulated impressions, best click through rate ${pct(
            bestCtrOf(cohort),
            2,
          )}`,
        };
      });

      guard();

      await step("decide", "Evaluate and decide", async () => {
        const res = await call<DecideResponse>(
          "/api/decide",
          { state: held.current },
          TIMEOUT.decide,
          "The spend decision",
        );
        held.current = absorb(res.state);
        held.decision = res.decision;
        held.evaluation = res.evaluation;
        onDecision(res.decision, res.evaluation);

        if (res.decision.shouldBuy) {
          return {
            detail: `Cleared to spend $${money(res.decision.amount)} at ${pct(
              res.evaluation.probabilityBest,
            )} probability best`,
            note: res.decision.reason,
          };
        }

        held.gate = blockingGate(res.evaluation);
        return {
          tone: "held",
          detail: held.gate
            ? `Held the money. The gate that stopped it: ${held.gate}.`
            : "Held the money. The evidence never cleared the gates.",
          note: res.decision.abstainedBecause ?? res.decision.reason,
        };
      });

      guard();

      if (!held.decision?.shouldBuy) {
        setEnding({
          kind: "held",
          headline: "The agent decided not to spend",
          text: held.gate
            ? `This is a valid outcome, not a failure. The gate that stopped the spend was "${held.gate}", so the agent kept the money and the run ends here.`
            : "This is a valid outcome, not a failure. The statistics never cleared the gates, so the agent kept the money and the run ends here.",
        });
        return;
      }

      await step("purchase", "Execute the purchase", async () => {
        const cohort = cohortOf(held.current);
        const res = await call<PurchaseResponse>(
          "/api/purchase",
          {
            amount: held.decision?.amount ?? "4.00",
            reason: held.decision?.reason ?? "Bandit called the winner",
            winnerId: held.evaluation?.candidateId ?? cohort[0]?.id,
            probabilityBest: held.evaluation?.probabilityBest ?? 0,
            impressions: cohort.reduce((sum, c) => sum + c.arm.impressions, 0),
            state: held.current,
          },
          TIMEOUT.purchase,
          "The purchase",
        );
        held.current = absorb(res);
        onReceipt(res.lastPurchase ?? null);
        held.bought = res.lastPurchase?.ok === true;

        if (held.bought) {
          return {
            detail: `Charged $${money(res.lastPurchase?.amount)} on a single use card ending ${
              res.lastPurchase?.cardLast4 ?? "????"
            }`,
          };
        }

        held.declined = res.lastPurchase?.errorCode ?? "declined";
        return {
          tone: "blocked",
          detail: `The mandate refused $${money(res.lastPurchase?.amount)}: ${held.declined}. Nothing was spent.`,
          note: res.lastPurchase?.message,
        };
      });

      guard();

      if (!held.bought) {
        setEnding({
          kind: "blocked",
          headline: "The mandate refused the charge",
          text: `The guardrail did its job and the agent could not spend. Code returned: ${
            held.declined ?? "declined"
          }. Nothing left the account and the run ends here.`,
        });
        return;
      }

      await step("evolve", "Breed four variants of the winner", async () => {
        const cohort = cohortOf(held.current);
        const parent = held.evaluation?.candidateId
          ? (cohort.find((c) => c.id === held.evaluation?.candidateId) ?? leaderOf(cohort))
          : leaderOf(cohort);
        if (!parent) throw new Error("There was no winning creative left to breed from");

        const next = await call<State>(
          "/api/creatives",
          { parentId: parent.id, state: held.current },
          TIMEOUT.creatives,
          "The breeding step",
        );
        held.current = absorb(next);
        onDecision(null, null);
        const bred = cohortOf(held.current);
        return {
          detail: `Bred ${bred.length} mutations of "${parent.headline}" into generation ${
            bred[0]?.generation ?? 1
          }`,
        };
      });

      guard();

      await step("simulate", `Retest with ${impressions.toLocaleString()} more`, async () => {
        const next = await call<State>(
          "/api/simulate",
          { impressions, state: held.current },
          TIMEOUT.simulate,
          "The second traffic simulation",
        );
        held.current = absorb(next);
        const cohort = cohortOf(held.current);
        return {
          detail: `Served ${impressions.toLocaleString()} more impressions on generation ${
            cohort[0]?.generation ?? 1
          }, best click through rate ${pct(bestCtrOf(cohort), 2)}`,
        };
      });

      setEnding({
        kind: "complete",
        headline: "The full loop closed",
        text: "Researched, wrote, tested, decided, spent under the mandate, bred the winner and retested the next generation.",
      });
    } catch (err) {
      if (err instanceof Cancelled) {
        setEnding({
          kind: "stopped",
          headline: "Stopped mid run",
          text: "Nothing else was requested. Everything already done above is kept, and the manual controls below pick up from here.",
        });
      } else {
        setEnding({
          kind: "failed",
          headline: "The run stopped on a failed step",
          text:
            err instanceof Error
              ? err.message
              : "A step failed without saying why. The manual controls below still work step by step.",
        });
      }
    } finally {
      cancelledRef.current = false;
      controllerRef.current = null;
      onRunningChange(false);
    }
  }, [state, absorb, impressions, call, step, onDecision, onReceipt, onRunningChange]);

  const ready = Boolean(state?.product);
  const patience = active !== null && waited >= PATIENCE_AFTER;

  const endingTone = useMemo(() => {
    if (!ending) return "";
    if (ending.kind === "complete") return "border-emerald-400/40 bg-emerald-400/[0.08]";
    if (ending.kind === "held") return "border-amber-400/40 bg-amber-400/[0.08]";
    if (ending.kind === "stopped") return "border-white/15 bg-white/[0.04]";
    return "border-rose-400/40 bg-rose-500/[0.08]";
  }, [ending]);

  const endingLabel = useMemo(() => {
    if (!ending) return "";
    if (ending.kind === "complete") return "text-emerald-300";
    if (ending.kind === "held") return "text-amber-300";
    if (ending.kind === "stopped") return "text-zinc-400";
    return "text-rose-300";
  }, [ending]);

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.05]">
      <div className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
            One click
          </span>
          <h2 className="text-[15px] font-semibold tracking-tight text-white sm:text-base">
            Run the whole demo
          </h2>
        </div>

        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-zinc-300 sm:text-[13px]">
          Seven steps end to end: research the market, write four ads with images, serve{" "}
          {impressions.toLocaleString()} impressions, evaluate the posteriors, spend only if the
          gates allow it, breed the winner and retest. The manual controls below stay live for
          anyone who wants to walk it step by step.
        </p>

        {running ? (
          <button
            type="button"
            onClick={cancel}
            className="mt-3 w-full rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-[15px] font-bold text-rose-200 transition-colors hover:bg-rose-500/20"
          >
            Stop the run
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!ready || disabled}
            className="mt-3 w-full rounded-xl bg-emerald-400 px-4 py-3.5 text-[15px] font-bold text-zinc-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 sm:text-base"
          >
            {entries.length > 0 ? "Run the full demo again" : "Run the full demo"}
          </button>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          {ready
            ? "Live run: real web search, real image generation and a real sandbox charge against the signed mandate."
            : "Submit a product on the home page first, then this runs the whole story on its own."}
        </p>
      </div>

      {active ? (
        <div className="border-t border-white/10 px-3 pb-3 sm:px-4">
          <div className="pt-3">
            <AgentStatus title={AGENT_STEPS[active.task].title} steps={AGENT_STEPS[active.task].steps} />
          </div>
          {patience ? (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-200/90">
              Still working after {waited}s. The web search and the image renders regularly take
              more than a minute, this is waiting, not broken.
            </p>
          ) : null}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 pt-3 sm:px-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              What the agent did
            </span>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {entries.filter((e) => e.status !== "running").length} of {TOTAL_STEPS}
            </span>
          </div>
          <ol className="divide-y divide-white/5 pb-1">
            {entries.map((entry) => (
              <TimelineRow key={entry.id} entry={entry} />
            ))}
          </ol>
        </>
      ) : null}

      {ending ? (
        <div className="px-3 pb-3 sm:px-4">
          <div className={`rounded-xl border px-3 py-2.5 ${endingTone}`}>
            <div
              className={`text-[11px] font-bold uppercase tracking-[0.14em] ${endingLabel}`}
            >
              {ending.headline}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-200 sm:text-[13px]">
              {ending.text}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
