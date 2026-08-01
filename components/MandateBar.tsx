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
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className="truncate text-sm font-semibold tabular-nums text-zinc-100">{value}</div>
      {hint ? <div className="truncate text-[11px] text-zinc-400">{hint}</div> : null}
    </div>
  );
}

function Tags({ source }: { source: string }) {
  const items = [`Budget ${source}`, "Simulated traffic", "Sandbox payments"];
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {items.map((item, i) => (
        <span key={item} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden="true" className="text-zinc-600">·</span> : null}
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">
            {item}
          </span>
        </span>
      ))}
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

  const meterFill = !armed
    ? "bg-zinc-700"
    : left > 0.5
      ? "bg-emerald-400"
      : left > 0.15
        ? "bg-amber-400"
        : "bg-rose-400";

  const live = Boolean(facts?.live);
  const remainingLabel = live && facts?.remaining ? facts.remaining : `$${money(shownRemaining)}`;
  const scopeLabel = (live && facts?.scope) || "Render credits only, one merchant";
  const expiryLabel = (live && facts?.expiry) || "On the signed mandate";
  const sourceLabel = live ? "live from Prava" : "local estimate";

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/85">
        <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6 sm:py-2.5">
          <div className="flex items-center gap-3">
            <span
              className={`relative flex h-2 w-2 shrink-0 rounded-full ${
                armed ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            >
              {working ? (
                <span
                  className={`absolute inset-0 animate-ping rounded-full ${
                    armed ? "bg-emerald-400" : "bg-zinc-500"
                  }`}
                />
              ) : null}
            </span>

            <div className="flex min-w-0 items-baseline gap-2">
              <span className="text-[13px] font-semibold tracking-tight text-white">banditd</span>
              <span className="truncate text-[11px] text-zinc-400">
                {armed ? "Mandate armed" : "No mandate signed"}
              </span>
            </div>

            <div className="ml-auto flex min-w-0 shrink items-center gap-2 sm:gap-3">
              <div className="hidden min-w-0 items-center gap-2 sm:flex">
                <div className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-white/12 md:w-32">
                  <div
                    className={`bar-fill h-full w-full ${meterFill}`}
                    style={{ transform: `scaleX(${armed ? left : 0})` }}
                  />
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                  {armed ? `$${money(shownSpent)} spent` : "Nothing approved"}
                </span>
              </div>

              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-white">
                {armed ? `${remainingLabel} left` : "No budget"}
              </span>

              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="mandate-detail"
                className="shrink-0 rounded-lg border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/10"
              >
                {open ? "Hide limits" : "Limits"}
              </button>
            </div>
          </div>

          <div className="mt-1">
            <Tags source={sourceLabel} />
          </div>
        </div>

        <div className="h-[3px] w-full overflow-hidden bg-white/10 sm:hidden">
          <div
            className={`bar-fill h-full w-full ${meterFill}`}
            style={{ transform: `scaleX(${armed ? left : 0})` }}
          />
        </div>
      </header>

      <div
        id="mandate-detail"
        className={`${open ? "block" : "hidden"} border-b border-white/10 bg-white/[0.02]`}
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6 sm:py-4">
          {armed ? (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Field
                  label="Budget left"
                  value={remainingLabel}
                  hint={live ? `of $${money(cap)} approved` : `of the $${money(cap)} ceiling`}
                />
                <Field label="Merchant scope" value={scopeLabel} hint="Nothing else can be charged" />
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
                <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-zinc-400">
                  Budget left and charges are counted from the runs in this browser against the
                  ceiling the demo assumes. The live balance, scope and expiry sit on the signed
                  mandate in Prava and are read server side on every purchase.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="text-[13px] font-semibold text-white">
                No mandate on file, so the agent cannot spend a cent.
              </div>
              <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-zinc-400">
                The seller signs a mandate with a passkey and that mandate is the leash: a spending
                ceiling, one merchant, and an expiry date. Until it exists every purchase attempt is
                refused before it reaches a card. Everything below still runs, only the charge is
                off.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Field label="Budget left" value="Not set" hint={`$${money(cap)} planned`} />
                <Field label="Merchant scope" value="Not set" hint="Render credits only" />
                <Field label="Expires" value="Not set" hint="Set when signed" />
                <Field
                  label="Charges"
                  value={`${charges} paid, ${blocked} blocked`}
                  hint="Nothing chargeable yet"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
