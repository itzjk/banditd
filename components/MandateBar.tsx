"use client";

import { useState } from "react";
import type { PurchaseEvent } from "@/lib/store";
import { money, shortId, toNumber } from "./format";
import { useCountUp } from "./motion";

export interface MandateFacts {
  live?: boolean;
  remaining?: string | null;
  scope?: string | null;
  expiry?: string | null;
  status?: string | null;
}

interface Props {
  mandateId: string | null;
  cap: number;
  purchases: PurchaseEvent[];
  facts?: MandateFacts;
  working?: boolean;
}

function Field({
  label,
  value,
  tone = "normal",
  hint,
}: {
  label: string;
  value: string;
  tone?: "normal" | "good" | "warn";
  hint?: string;
}) {
  const color =
    tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-zinc-100";
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className={`truncate text-sm font-semibold tabular-nums sm:text-[15px] ${color}`}>
        {value}
      </div>
      {hint ? <div className="truncate text-[11px] text-zinc-400">{hint}</div> : null}
    </div>
  );
}

export default function MandateBar({ mandateId, cap, purchases, facts, working }: Props) {
  const [open, setOpen] = useState(false);

  const spent = purchases.filter((p) => p.ok).reduce((sum, p) => sum + toNumber(p.amount), 0);
  const blocked = purchases.filter((p) => !p.ok).length;
  const charges = purchases.filter((p) => p.ok).length;
  const remaining = Math.max(0, cap - spent);
  const left = cap > 0 ? Math.max(0, Math.min(1, remaining / cap)) : 0;
  const armed = Boolean(mandateId);
  const shownRemaining = useCountUp(remaining);
  const shownSpent = useCountUp(spent);
  const low = armed && left <= 0.2;

  const live = Boolean(facts?.live);
  const remainingLabel = live && facts?.remaining ? facts.remaining : `$${money(shownRemaining)}`;
  const scopeLabel = (live && facts?.scope) || "Render credits only, one merchant";
  const expiryLabel = (live && facts?.expiry) || "On the signed mandate";
  const sourceLabel = live ? "Live from Prava" : "Local estimate";

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/80">
      <div className="mx-auto w-full max-w-6xl px-4 py-2.5 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`relative flex h-2.5 w-2.5 shrink-0 rounded-full ${
                armed ? "bg-emerald-400" : "bg-amber-400"
              }`}
            >
              {working ? (
                <span
                  className={`absolute inset-0 animate-ping rounded-full ${
                    armed ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
              ) : null}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold tracking-tight text-white">banditd</div>
              <div className="truncate text-[11px] text-zinc-400">
                {armed ? "Mandate armed" : "No mandate signed"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-right leading-tight sm:hidden">
              <div
                className={`text-sm font-bold tabular-nums ${
                  armed && remaining > 0 ? "text-emerald-300" : "text-amber-300"
                }`}
              >
                {armed ? `${remainingLabel} left` : "No budget"}
              </div>
              <div className="text-[10px] text-zinc-400">
                {charges} paid, {blocked} blocked
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 sm:hidden"
            >
              {open ? "Hide" : "Limits"}
            </button>

            <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
              <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
                Budget {sourceLabel}
              </span>
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                Simulated traffic
              </span>
              <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                Sandbox payments
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 sm:mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`bar-fill h-full w-full ${
                low ? "bg-amber-400" : "bg-gradient-to-r from-emerald-400 to-emerald-300"
              }`}
              style={{ transform: `scaleX(${armed ? left : 0})` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-400">
            <span className="truncate">
              {armed
                ? live
                  ? `$${money(shownRemaining)} left of the $${money(cap)} ceiling`
                  : `Local estimate: $${money(shownRemaining)} left of the $${money(cap)} ceiling`
                : "The agent cannot spend a cent yet"}
            </span>
            <span className="shrink-0 tabular-nums">
              {armed ? `$${money(shownSpent)} spent` : "Nothing approved yet"}
            </span>
          </div>
        </div>

        <div className={`${open ? "block" : "hidden"} sm:block`}>
          {armed ? (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Field
                  label="Budget left"
                  value={remainingLabel}
                  tone={remaining > 0 ? "good" : "warn"}
                  hint={live ? `of $${money(cap)} approved` : `of the $${money(cap)} ceiling`}
                />
                <Field
                  label="Merchant scope"
                  value={scopeLabel}
                  hint="Nothing else can be charged"
                />
                <Field
                  label="Expires"
                  value={expiryLabel}
                  hint={(live && facts?.status) || "Revocable anytime"}
                />
                <Field
                  label="Charges"
                  value={`${charges} paid, ${blocked} blocked`}
                  hint={`Mandate ${shortId(mandateId, 8)}`}
                />
              </div>
              {live ? null : (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                  Budget left and charges are counted from the runs in this browser against the
                  ceiling the demo assumes. The live balance, scope and expiry sit on the signed
                  mandate in Prava and are read server side on every purchase.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
              <div className="text-[13px] font-semibold text-amber-200 sm:text-sm">
                No mandate on file, so the agent cannot spend a cent.
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-400 sm:text-[13px]">
                The seller signs a mandate with a passkey and that mandate is the leash: a spending
                ceiling, one merchant, and an expiry date. Until it exists every purchase attempt is
                refused before it reaches a card. Everything below still runs, only the charge is
                off.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Field
                  label="Budget left"
                  value="Not set"
                  tone="warn"
                  hint={`$${money(cap)} planned`}
                />
                <Field label="Merchant scope" value="Not set" hint="Render credits only" />
                <Field label="Expires" value="Not set" hint="Set when signed" />
                <Field
                  label="Charges"
                  value={`${charges} paid, ${blocked} blocked`}
                  hint="Nothing chargeable yet"
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-300">
            Budget {sourceLabel}
          </span>
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
            Simulated traffic
          </span>
          <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
            Sandbox payments
          </span>
        </div>
      </div>
    </header>
  );
}
