"use client";

import { useState } from "react";
import type { PurchaseEvent } from "@/lib/store";
import { clock, money, pct, shortId, timeAgo } from "./format";

interface Props {
  event: PurchaseEvent;
  winnerHeadline?: string | null;
  latest?: boolean;
}

const DECLINES: Record<string, { title: string; plain: string }> = {
  THRESHOLD_EXCEEDED: {
    title: "Over the ceiling the seller signed",
    plain:
      "The charge asked for more than the per charge cap on the mandate, so Visa refused it before any money moved. The mandate is still alive and the agent can try again for less.",
  },
  MANDATE_MERCHANT_NOT_ALLOWED: {
    title: "Merchant outside the mandate",
    plain:
      "This mandate only pays one named merchant and the charge came from a different one. Nothing was spent. The seller would have to sign a mandate that names this merchant.",
  },
  MANDATE_NOT_ACTIVE: {
    title: "Mandate no longer usable",
    plain:
      "The mandate was consumed, paused, revoked or it expired, so it cannot be charged. Nothing was spent. The seller signs a fresh one to switch the agent back on.",
  },
  TRIES_EXHAUSTED: {
    title: "No charges left on the mandate",
    plain:
      "The mandate allowed a fixed number of charges and they are all used. Nothing was spent on this attempt.",
  },
  CYCLE_ALREADY_CHARGED: {
    title: "Already charged this cycle",
    plain:
      "A recurring mandate allows one charge per cycle and this one was already used. Nothing was spent. The seller signs another mandate, or the agent waits for the cycle to renew.",
  },
  DECLINED: {
    title: "Visa declined the charge",
    plain: "The card network refused the charge. Nothing was spent and the mandate is untouched.",
  },
  CHARGE_FAILED: {
    title: "The card declined the charge",
    plain: "The network refused the charge. Nothing was spent and the mandate is untouched.",
  },
};

function SimTag() {
  return (
    <span className="rounded border border-white/12 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
      Sim
    </span>
  );
}

function explain(code: string | null): { title: string; plain: string } {
  if (!code) return { title: "Charge declined", plain: "The charge did not go through." };
  const known = DECLINES[code];
  if (known) return known;
  if (code.startsWith("HTTP_")) {
    return {
      title: "Prava did not answer",
      plain: `The payment sandbox replied with ${code.replace("HTTP_", "status ")} instead of a result. No card was charged, the attempt simply never reached one.`,
    };
  }
  return {
    title: "Charge declined",
    plain: "The mandate refused this charge, so nothing was spent.",
  };
}

export default function PurchaseEventItem({ event, winnerHeadline, latest }: Props) {
  const ok = event.ok;
  const reason = explain(event.errorCode);
  const [entrance] = useState(
    () => Boolean(latest) && Date.now() - Date.parse(event.at) < 15000,
  );

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border ${
        entrance ? (ok ? "event-in" : "event-in-blocked") : ""
      } ${
        ok
          ? "border-emerald-400/35 bg-emerald-400/[0.05]"
          : "border-rose-400/40 bg-rose-400/[0.06]"
      }`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4 ${
          ok ? "bg-emerald-400/10" : "bg-rose-400/10"
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
              ok ? "bg-emerald-400/20 text-emerald-300" : "bg-rose-400/20 text-rose-300"
            }`}
          >
            {ok ? "Charged" : "Blocked"}
          </span>
          <span
            className={`text-lg font-bold tabular-nums ${ok ? "text-emerald-200" : "text-rose-200"}`}
          >
            ${money(event.amount)}
          </span>
        </div>
        <div className="text-[11px] tabular-nums text-zinc-400">
          {timeAgo(event.at)}, {clock(event.at)}
        </div>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Why the agent did this
          </div>
          <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-200">{event.reason}</p>
        </div>

        {!ok ? (
          <div className="rounded-xl border border-rose-400/25 bg-rose-500/[0.07] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-rose-400/15 px-1.5 py-0.5 font-mono text-[11px] text-rose-300">
                {event.errorCode ?? "DECLINED"}
              </span>
              <span className="text-[13px] font-semibold text-rose-200">{reason.title}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-300">{reason.plain}</p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">Card</div>
            {event.cardLast4 ? (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm text-zinc-100">
                  {"•••• "}
                  {event.cardLast4}
                </span>
                <span className="rounded border border-white/12 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                  Single use
                </span>
              </div>
            ) : (
              <div className="text-sm text-zinc-400">None issued</div>
            )}
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
              Confidence
              <SimTag />
            </div>
            <div className="text-sm font-semibold tabular-nums text-zinc-100">
              {event.probabilityBest ? pct(event.probabilityBest) : "n/a"}
            </div>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
              Impressions
              <SimTag />
            </div>
            <div className="text-sm font-semibold tabular-nums text-zinc-100">
              {event.impressions.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-400">
              Transaction
            </div>
            <div className="truncate font-mono text-[12px] text-zinc-300">
              {event.transactionId ? shortId(event.transactionId, 8) : "none"}
            </div>
          </div>
        </div>

        <div className="break-words text-[11px] text-zinc-400">
          Bought for {winnerHeadline ? `"${winnerHeadline}"` : shortId(event.winnerId, 10)}. The card
          number never touches the agent, it is minted for this one charge and dies with it.
        </div>
      </div>
    </article>
  );
}
