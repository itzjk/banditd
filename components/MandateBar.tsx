"use client";

import { useState, type ReactNode } from "react";
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
    <div className="min-w-0 bg-zinc-950 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className="mt-1 break-words text-[14px] font-semibold leading-snug tabular-nums text-white [overflow-wrap:anywhere]">
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 break-words text-[11px] leading-snug text-zinc-400 [overflow-wrap:anywhere]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Readout({
  label,
  value,
  tone,
  badge,
}: {
  label: string;
  value: string;
  tone: string;
  badge?: ReactNode;
}) {
  return (
    <div className="min-w-0 text-right">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className="mt-0.5 flex items-center justify-end gap-1.5">
        <span className={`truncate text-[13px] font-semibold tabular-nums ${tone}`}>{value}</span>
        {badge}
      </div>
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`h-2.5 w-2.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
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

  const meterText = !armed
    ? "text-zinc-400"
    : left > 0.5
      ? "text-emerald-300"
      : left > 0.15
        ? "text-amber-300"
        : "text-rose-300";

  const live = Boolean(facts?.live);
  const remainingLabel = live && facts?.remaining ? facts.remaining : `$${money(shownRemaining)}`;
  const scopeLabel = (live && facts?.scope) || "Render credits only, one merchant";
  const expiryLabel = (live && facts?.expiry) || "On the signed mandate";

  return (
    <>
      <header className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/85">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6 sm:py-2.5">
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

          <span className="shrink-0 text-[13px] font-semibold tracking-tight text-white">
            banditd
          </span>

          <span aria-hidden="true" className="hidden h-3.5 w-px shrink-0 bg-white/12 sm:block" />

          <span className="hidden truncate text-[12px] text-zinc-300 sm:block">
            {armed ? "Mandate armed" : "No mandate signed"}
          </span>

          <span className="shrink-0 rounded border border-white/15 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            <span className="sm:hidden">Sandbox</span>
            <span className="hidden sm:inline">Sandbox payments</span>
          </span>

          <div className="ml-auto flex min-w-0 shrink items-center gap-2.5 sm:gap-4">
            <div className="hidden sm:block">
              <Readout
                label="Spent"
                value={armed ? `$${money(shownSpent)}` : "None"}
                tone="text-zinc-100"
              />
            </div>

            <span aria-hidden="true" className="hidden h-8 w-px shrink-0 bg-white/10 sm:block" />

            <Readout
              label={armed ? "Budget left" : "Budget"}
              value={armed ? remainingLabel : "Not set"}
              tone={meterText}
              badge={
                armed ? (
                  <span className="shrink-0 rounded border border-white/15 px-1 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
                    <span className="sm:hidden">{live ? "Live" : "Est"}</span>
                    <span className="hidden sm:inline">{live ? "Live" : "Local estimate"}</span>
                  </span>
                ) : null
              }
            />

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mandate-detail"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.05] px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors duration-150 hover:border-white/25 hover:bg-white/10 hover:text-white"
            >
              Limits
              <Caret open={open} />
            </button>
          </div>
        </div>

        <div className="h-[2px] w-full bg-white/10">
          <div
            className={`bar-fill h-full w-full ${meterFill}`}
            style={{ transform: `scaleX(${armed ? left : 0})` }}
          />
        </div>
      </header>

      <div
        id="mandate-detail"
        className={`${open ? "block" : "hidden"} border-b border-white/10 bg-zinc-950`}
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6 sm:py-4">
          {armed ? (
            <>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/[0.08] sm:grid-cols-4">
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
                <p className="mt-3 max-w-3xl break-words text-[11px] leading-relaxed text-zinc-400">
                  Budget left is a local estimate: it counts the runs in this browser against the
                  ceiling the demo assumes. The live balance, scope and expiry sit on the signed
                  mandate in Prava and are read server side on every purchase, which runs in the
                  Prava sandbox.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="text-[13px] font-semibold text-white">
                No mandate on file, so the agent cannot spend a cent.
              </div>
              <p className="mt-1 max-w-3xl break-words text-[12px] leading-relaxed text-zinc-400">
                The seller signs a mandate with a passkey and that mandate is the leash: a spending
                ceiling, one merchant, and an expiry date. Until it exists every purchase attempt is
                refused before it reaches a card. Everything below still runs, only the charge is
                off.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/[0.08] sm:grid-cols-4">
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
