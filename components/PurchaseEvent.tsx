"use client";

import { useState, type ReactNode } from "react";
import type { PurchaseEvent } from "@/lib/store";
import { declineFamily, type DeclineFamily } from "@/lib/declines";
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
  FETCH_AGENTIC_CREDS_ERROR: {
    title: "The payment provider could not issue the card",
    plain:
      "Prava could not get the single use card credentials from Visa, so the charge never reached a card. No rule on the mandate refused this spend and nothing was spent: the failure is on the payment provider side. Prava can still count the attempt against this mandate's cycle, so the agent moves to the next signed mandate instead of retrying this one.",
  },
  NO_TOKEN: {
    title: "The provider returned no card to charge",
    plain:
      "Prava answered without the single use card credentials, so there was nothing for the charge to run on. Nothing was spent and no rule on the mandate refused it. The same charge can go out again once the provider returns a card.",
  },
  VISA_CONFIRMATION_FAILED: {
    title: "Visa never confirmed the charge",
    plain:
      "The charge went out and Visa did not come back with a confirmation, so the payment provider could not close it. No rule on the mandate refused this spend. The reference below is what to check on the Prava side before the agent charges again.",
  },
  PROVIDER_UNREACHABLE: {
    title: "The payment provider could not process it",
    plain:
      "Prava either failed on its own side or never answered, so the charge could not be completed and no card was issued. Nothing was spent and no rule on the mandate refused it: what broke is the payment provider, not the authorization the seller signed.",
  },
  DECLINED: {
    title: "The charge came back declined",
    plain:
      "The card network refused the charge without saying which rule stopped it, so this is not proof the mandate did its job. Nothing was spent.",
  },
  CHARGE_FAILED: {
    title: "The charge did not complete",
    plain:
      "Prava returned the charge as failed with no reason code, so it is not clear whether a mandate rule stopped it or the payment side did. Nothing was spent.",
  },
};

function SimTag() {
  return (
    <span className="rounded border border-white/12 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
      Sim
    </span>
  );
}

interface Reason {
  title: string;
  plain: string;
  family: DeclineFamily;
}

const UNKNOWN_PLAIN =
  "The charge did not complete and Prava did not say whether a rule on the mandate stopped it or the payment side failed, so this is not proof the guardrail did anything. Nothing was spent.";

function explain(code: string | null): Reason {
  const family = declineFamily(code);
  if (!code) {
    return { family, title: "The charge did not complete", plain: UNKNOWN_PLAIN };
  }
  const known = DECLINES[code];
  if (known) return { ...known, family };
  if (code.startsWith("HTTP_")) {
    const status = code.replace("HTTP_", "status ");
    if (family === "request") {
      return {
        family,
        title: "The request was rejected before any mandate rule",
        plain: `The payment sandbox answered with ${status} and refused the request itself. That is a fault on our side of the call, not the mandate protecting the seller. Nothing was spent.`,
      };
    }
    return {
      family,
      title: "The payment provider did not answer",
      plain: `The payment sandbox replied with ${status} instead of a result, so the charge never reached a card. No rule on the mandate refused this spend and nothing was spent.`,
    };
  }
  if (family === "provider") {
    return {
      family,
      title: "The payment provider could not process it",
      plain: `Prava came back with ${code} instead of a card, so the charge could not be completed. No rule on the mandate refused this spend and nothing was spent: the failure is on the payment provider side.`,
    };
  }
  if (family === "request") {
    return {
      family,
      title: "The request was rejected before any mandate rule",
      plain: `Prava rejected the request itself with ${code}. That is a fault on our side of the call, not the mandate protecting the seller. Nothing was spent.`,
    };
  }
  return { family, title: "The charge did not complete", plain: UNKNOWN_PLAIN };
}

const SUMMARY_LINE: Record<DeclineFamily, string> = {
  guardrail: "Refused on the rail, no money moved.",
  provider: "The payment provider could not process it, the mandate did not refuse it.",
  request: "The call was malformed on our side, the mandate did not refuse it.",
  unknown: "Nothing was spent, and this was not the mandate refusing the charge.",
};

const BADGE_LABEL: Record<DeclineFamily, string> = {
  guardrail: "Blocked",
  provider: "Not processed",
  request: "Bad request",
  unknown: "Not completed",
};

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
      <div className="flex flex-wrap items-center gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
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
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
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
  const refused = !ok && reason.family === "guardrail";
  const [entrance] = useState(
    () => Boolean(latest) && Date.now() - Date.parse(event.at) < 15000,
  );

  return (
    <details
      className={`group relative overflow-hidden border-l-2 ${
        entrance ? (ok ? "event-in" : refused ? "event-in-blocked" : "enter-soft") : ""
      } ${
        ok
          ? "border-l-emerald-400/70"
          : refused
            ? "border-l-rose-400/70 bg-rose-500/[0.04]"
            : "border-l-amber-400/70 bg-amber-400/[0.04]"
      }`}
    >
      <summary className="focus-ring block cursor-pointer list-none px-3 py-3 transition-colors hover:bg-white/[0.03] sm:px-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
              ok
                ? "bg-emerald-400/20 text-emerald-300"
                : refused
                  ? "bg-rose-400/20 text-rose-300"
                  : "bg-amber-400/20 text-amber-200"
            }`}
          >
            {ok ? "Charged" : BADGE_LABEL[reason.family]}
          </span>
          <span
            className={`text-[19px] font-semibold leading-none tabular-nums ${
              ok ? "text-emerald-200" : refused ? "text-rose-200" : "text-amber-100"
            }`}
          >
            ${money(event.amount)}
          </span>
          {!ok ? (
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] [overflow-wrap:anywhere] ${
                refused ? "bg-rose-400/15 text-rose-300" : "bg-amber-400/15 text-amber-200"
              }`}
            >
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
          <p
            className={`mt-2 text-[12px] font-medium leading-snug ${
              refused ? "text-rose-200" : "text-amber-100"
            }`}
          >
            {reason.title}. {SUMMARY_LINE[reason.family]}
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
              <span className="rounded border border-white/12 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
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
          <div
            className={`rounded-xl border p-3 ${
              refused
                ? "border-rose-400/25 bg-rose-500/[0.07]"
                : "border-amber-400/25 bg-amber-400/[0.07]"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${
                  refused ? "bg-rose-400/15 text-rose-300" : "bg-amber-400/15 text-amber-200"
                }`}
              >
                {event.errorCode ?? "DECLINED"}
              </span>
              <span
                className={`text-[13px] font-semibold ${
                  refused ? "text-rose-200" : "text-amber-100"
                }`}
              >
                {reason.title}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-300">{reason.plain}</p>
            <div className="mt-2 rounded-lg bg-zinc-950/80 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
              {refused
                ? `prava.sandbox: charge declined, code ${event.errorCode ?? "DECLINED"}, funds moved 0.00`
                : `prava.sandbox: charge not completed, code ${event.errorCode ?? "DECLINED"}, no card issued`}
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
  const held = events.reduce(
    (sum, e) => (!e.ok && declineFamily(e.errorCode) === "guardrail" ? sum + toNumber(e.amount) : sum),
    0,
  );
  const stalled = events.reduce(
    (sum, e) => (!e.ok && declineFamily(e.errorCode) !== "guardrail" ? sum + toNumber(e.amount) : sum),
    0,
  );
  const charged = events.filter((e) => e.ok).length;

  return (
    <div className="overflow-hidden rounded-2xl bg-white/[0.02]">
      <div
        className={`grid divide-x divide-white/[0.07] border-b border-white/[0.07] bg-white/[0.02] ${
          stalled > 0 ? "grid-cols-2 divide-y sm:grid-cols-4 sm:divide-y-0" : "grid-cols-3"
        }`}
      >
        <Total label="Spent" value={`$${money(spent)}`} dot="bg-emerald-400" />
        <Total label="Blocked" value={`$${money(held)}`} dot="bg-rose-400" />
        {stalled > 0 ? (
          <Total label="Not processed" value={`$${money(stalled)}`} dot="bg-amber-400" />
        ) : null}
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
            Every attempt lands here the moment it happens: the charges that clear, the ones the
            mandate refuses and the ones the payment provider could not process.
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
