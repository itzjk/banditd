"use client";

import { useState, type ReactNode } from "react";
import type { PurchaseEvent } from "@/lib/store";
import { clock, money, pct, plain, shortId, timeAgo, toNumber } from "./format";

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
  NO_MANDATE_AVAILABLE: {
    title: "No mandate left to charge this cycle",
    plain:
      "Every mandate the seller signed has already been charged in this monthly cycle, so there was nothing left to charge. Nothing was spent. A Prava mandate on a monthly frequency allows one charge per cycle: the seller signs another mandate for the agent to keep buying before the cycle renews.",
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

function Caret() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
      <path
        d="M2.5 4.5L6 8l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Fact({
  label,
  sim,
  children,
}: {
  label: string;
  sim?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-white/[0.04] px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">
        {label}
        {sim ? <SimTag /> : null}
      </div>
      <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-100 [overflow-wrap:anywhere]">
        {children}
      </div>
    </div>
  );
}

function Total({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="min-w-0 px-1.5 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center gap-1">
        {dot ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} /> : null}
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400 sm:tracking-[0.14em]">
          {label}
        </span>
      </div>
      <div className="mt-1 truncate text-[14px] font-semibold leading-tight tabular-nums text-white sm:text-[16px]">
        {value}
      </div>
    </div>
  );
}

export default function PurchaseEventItem({ event, winnerHeadline, latest }: Props) {
  const ok = event.ok;
  const reason = explain(event.errorCode);
  const [entrance] = useState(
    () => Boolean(latest) && Date.now() - Date.parse(event.at) < 15000,
  );

  return (
    <details
      className={`group relative overflow-hidden border-l-2 ${
        entrance ? (ok ? "event-in" : "event-in-blocked") : ""
      } ${ok ? "border-l-emerald-400/70" : "border-l-rose-400/70 bg-rose-500/[0.04]"}`}
    >
      <summary className="focus-ring block cursor-pointer list-none px-3 py-3 transition-colors hover:bg-white/[0.03] sm:px-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
              ok ? "bg-emerald-400/20 text-emerald-300" : "bg-rose-400/20 text-rose-300"
            }`}
          >
            {ok ? "Charged" : "Blocked"}
          </span>
          <span
            className={`text-[19px] font-semibold leading-none tabular-nums ${
              ok ? "text-emerald-200" : "text-rose-200"
            }`}
          >
            ${money(event.amount)}
          </span>
          {!ok ? (
            <span className="rounded-md bg-rose-400/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-300 [overflow-wrap:anywhere]">
              {event.errorCode ?? "DECLINED"}
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-[11px] tabular-nums text-zinc-400">
              {timeAgo(event.at)}, {clock(event.at)}
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/12 bg-white/[0.05] text-zinc-300 transition-transform duration-200 group-open:rotate-180">
              <Caret />
            </span>
          </span>
        </div>

        {!ok ? (
          <p className="mt-2 text-[12px] font-medium leading-snug text-rose-200">
            {reason.title}. Refused on the rail, no money moved.
          </p>
        ) : null}

        <p className="mt-1.5 break-words text-[13px] leading-relaxed text-zinc-200">
          &ldquo;{plain(event.reason)}&rdquo;
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-400">
          {event.cardLast4 ? (
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-zinc-300">
                {"•••• "}
                {event.cardLast4}
              </span>
              <span className="rounded border border-white/12 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                Single use
              </span>
            </span>
          ) : (
            <span>No card issued</span>
          )}
          <span className="font-mono [overflow-wrap:anywhere]">
            {event.transactionId ? shortId(event.transactionId, 8) : "no transaction id"}
          </span>
        </div>
      </summary>

      <div className="space-y-3 px-3 pb-3.5 sm:px-4">
        {!ok ? (
          <div className="rounded-xl border border-rose-400/25 bg-rose-500/[0.07] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-rose-400/15 px-1.5 py-0.5 font-mono text-[11px] text-rose-300">
                {event.errorCode ?? "DECLINED"}
              </span>
              <span className="text-[13px] font-semibold text-rose-200">{reason.title}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-300">{reason.plain}</p>
            <div className="mt-2 rounded-lg bg-zinc-950/80 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
              prava.sandbox: charge declined, code {event.errorCode ?? "DECLINED"}, funds moved 0.00
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact label="Mandate">
            {event.mandateId ? (
              <span className="font-mono text-[12px]">{shortId(event.mandateId, 8)}</span>
            ) : (
              "none"
            )}
          </Fact>
          <Fact label="Reference">
            {event.transactionId ? (
              <span className="font-mono text-[12px]">{shortId(event.transactionId, 10)}</span>
            ) : (
              "none"
            )}
          </Fact>
          <Fact label="Confidence" sim>
            {event.probabilityBest ? pct(event.probabilityBest) : "n/a"}
          </Fact>
          <Fact label="Impressions" sim>
            {event.impressions.toLocaleString()}
          </Fact>
        </div>

        <p className="break-words text-[11px] leading-relaxed text-zinc-400">
          {ok ? "Bought for" : "Tried to buy for"}{" "}
          {winnerHeadline ? `"${winnerHeadline}"` : shortId(event.winnerId, 10)}. The card
          number never touches the agent, it is minted for this one charge and dies with it.
        </p>
      </div>
    </details>
  );
}

interface LedgerProps {
  events: PurchaseEvent[];
  headlineFor?: (id: string) => string | null;
}

export function PurchaseLedger({ events, headlineFor }: LedgerProps) {
  const spent = events.reduce((sum, e) => (e.ok ? sum + toNumber(e.amount) : sum), 0);
  const held = events.reduce((sum, e) => (e.ok ? sum : sum + toNumber(e.amount)), 0);
  const charged = events.filter((e) => e.ok).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="grid grid-cols-3 divide-x divide-white/[0.07] border-b border-white/[0.07] bg-white/[0.02]">
        <Total label="Spent" value={`$${money(spent)}`} dot="bg-emerald-400" />
        <Total label="Blocked" value={`$${money(held)}`} dot="bg-rose-400" />
        <Total label="Charges" value={`${charged} of ${events.length}`} />
      </div>

      {events.length ? (
        <div className="divide-y divide-white/[0.07]">
          {events.map((e, i) => (
            <PurchaseEventItem
              key={e.id}
              event={e}
              latest={i === 0}
              winnerHeadline={headlineFor ? headlineFor(e.winnerId) : null}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center">
          <p className="text-[13px] font-medium text-zinc-200">No money has moved yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-zinc-400">
            Every attempt lands here the moment it happens, the charges that clear and the ones
            the mandate refuses.
          </p>
        </div>
      )}

      <div className="border-t border-white/[0.07] bg-zinc-950/60 px-3 py-2 sm:px-4">
        <span className="block text-[11px] leading-snug text-zinc-400">
          Cleared through the Prava sandbox on Visa tokenization. Each charge mints its own single
          use card, so the agent never holds a real number.
        </span>
      </div>
    </div>
  );
}
