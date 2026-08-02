"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { PurchaseEvent } from "@/lib/store";
import type { SignedMandate } from "@/lib/authorization";
import { money, shortId, toNumber } from "./format";
import { useCountUp } from "./motion";
import { declineFamily } from "@/lib/declines";

interface Props {
  mandateId: string | null;
  cap: number;
  purchases: PurchaseEvent[];
  working?: boolean;
  chargeable?: boolean;
  revoked?: boolean;
  onRevoke?: () => void;
}

interface FactsRead {
  live: boolean;
  error: string | null;
  mandate: SignedMandate | null;
  queued: number;
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
        <div className="mt-0.5 break-words text-[12px] leading-snug text-zinc-400 [overflow-wrap:anywhere]">
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
    <div className="min-w-0 sm:text-right">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 sm:justify-end">
        <span className={`text-[15px] font-semibold tabular-nums sm:text-[13px] ${tone}`}>
          {value}
        </span>
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

export default function MandateBar({
  mandateId,
  cap,
  purchases,
  working,
  chargeable = true,
  revoked = false,
  onRevoke,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [read, setRead] = useState<FactsRead | null>(null);

  useEffect(() => {
    if (!mandateId) return;
    let alive = true;
    fetch(`/authorization/facts?id=${encodeURIComponent(mandateId)}`, { cache: "no-store" })
      .then((res) => res.json() as Promise<FactsRead>)
      .then((payload) => {
        if (alive) setRead(payload);
      })
      .catch(() => {
        if (alive) setRead({ live: false, error: null, mandate: null, queued: 0 });
      });
    return () => {
      alive = false;
    };
  }, [mandateId, revoked, purchases.length]);

  const spent = purchases.filter((p) => p.ok).reduce((sum, p) => sum + toNumber(p.amount), 0);
  const blocked = purchases.filter(
    (p) => !p.ok && declineFamily(p.errorCode) === "guardrail",
  ).length;
  const unfinished = purchases.filter(
    (p) => !p.ok && declineFamily(p.errorCode) !== "guardrail",
  ).length;
  const charges = purchases.filter((p) => p.ok).length;
  const armed = Boolean(mandateId);
  const dry = armed && !chargeable;
  const shownSpent = useCountUp(spent);

  const signed = read?.live ? read.mandate : null;
  const live = Boolean(signed);
  const cycleUsed = dry || Boolean(signed?.chargeUsedThisCycle);
  const ceiling = signed?.ceiling ?? null;
  const shownId = signed?.id ?? mandateId;

  const cycleValue = !armed
    ? "Not set"
    : revoked
      ? "Revoked"
      : cycleUsed
        ? "Charge used"
        : live
          ? "1 charge left"
          : read
            ? "Not read"
            : "Reading";

  const cycleTone = !armed
    ? "text-zinc-400"
    : revoked
      ? "text-rose-300"
      : cycleUsed
        ? "text-amber-300"
        : live
          ? "text-emerald-300"
          : "text-zinc-300";

  const meterFill = !armed
    ? "bg-zinc-700"
    : revoked
      ? "bg-rose-400"
      : cycleUsed
        ? "bg-amber-400"
        : live
          ? "bg-emerald-400"
          : "bg-zinc-600";

  return (
    <>
      <header className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/85">
        <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6 sm:py-2.5">
          <div className="flex items-center gap-2 sm:gap-3">
            <span
              className={`relative flex h-2 w-2 shrink-0 rounded-full ${
                !armed ? "bg-zinc-600" : revoked ? "bg-rose-400" : cycleUsed ? "bg-amber-400" : "bg-emerald-400"
              }`}
            >
              {working ? (
                <span
                  className={`absolute inset-0 animate-ping rounded-full ${
                    !armed ? "bg-zinc-500" : cycleUsed ? "bg-amber-400" : "bg-emerald-400"
                  }`}
                />
              ) : null}
            </span>

            <Link
              href="/"
              aria-label="banditd, back to the start screen"
              className="flex min-h-[2.75rem] shrink-0 items-center rounded-md px-1.5 text-[14px] font-semibold tracking-tight text-white underline decoration-white/30 underline-offset-4 transition-colors hover:bg-white/[0.08] hover:decoration-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:text-[13px]"
            >
              banditd
            </Link>

            <span aria-hidden="true" className="hidden h-3.5 w-px shrink-0 bg-white/12 sm:block" />

            <span className="hidden truncate text-[12px] text-zinc-300 sm:block">
              {!armed
                ? "No mandate signed"
                : revoked
                  ? "Mandate revoked by the seller"
                  : cycleUsed
                    ? "Mandate signed, its charge for this cycle is used"
                    : "Mandate armed"}
            </span>

            <span className="shrink-0 rounded border border-white/15 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
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

              <div className="hidden sm:block">
                <Readout
                  label="This cycle"
                  value={cycleValue}
                  tone={cycleTone}
                  badge={
                    armed && read ? (
                      <span className="shrink-0 rounded border border-white/15 px-1 py-px text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                        {live ? "Live" : "Unread"}
                      </span>
                    ) : null
                  }
                />
              </div>

              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="mandate-detail"
                className="-mr-1.5 flex min-h-[2.75rem] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/10 hover:text-white sm:mr-0 sm:border sm:border-white/12 sm:bg-white/[0.05] sm:py-1.5 sm:text-[11px] sm:hover:border-white/25"
              >
                Limits and stop
                <Caret open={open} />
              </button>
            </div>
          </div>

          <div className="mt-1.5 flex items-baseline gap-4 sm:hidden">
            <Readout
              label="This cycle"
              value={cycleValue}
              tone={cycleTone}
              badge={
                armed && read ? (
                  <span className="shrink-0 rounded border border-white/15 px-1 py-px text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    {live ? "Live" : "Unread"}
                  </span>
                ) : null
              }
            />
            <Readout
              label="Spent"
              value={armed ? `$${money(shownSpent)}` : "None"}
              tone="text-zinc-100"
            />
          </div>
        </div>

        <div className="h-[2px] w-full bg-white/10">
          <div
            className={`bar-fill h-full w-full ${meterFill}`}
            style={{ transform: `scaleX(${armed && !revoked && !cycleUsed ? 1 : 0})` }}
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
                  label="This cycle"
                  value={revoked ? "Revoked" : cycleUsed ? "Charge used" : cycleValue}
                  hint={
                    revoked
                      ? "the authorization is dead, nothing can be charged"
                      : cycleUsed
                        ? "the ceiling is intact and still nothing can be spent until it renews"
                        : "one charge per cycle on a monthly mandate"
                  }
                />
                <Field
                  label="Most it can charge"
                  value={ceiling !== null ? `$${money(ceiling)}` : `$${money(cap)}`}
                  hint={
                    live ? "per charge, read from Prava" : "planned ceiling, not read from Prava"
                  }
                />
                <Field
                  label="Merchant"
                  value={signed?.merchant ?? "Render credits only"}
                  hint={live ? "nothing else can be charged" : "not read from Prava"}
                />
                <Field
                  label="Expires"
                  value={signed?.expiry ?? "Not read"}
                  hint={live ? "revocable anytime, before or after" : "the date sits on the mandate"}
                />
              </div>

              <p className="mt-2.5 max-w-3xl break-words text-[12px] leading-snug text-zinc-400">
                {charges} paid, {blocked} refused by the mandate
                {unfinished > 0
                  ? `, ${unfinished} the payment provider could not process`
                  : ""}{" "}
                in this run, on mandate {shortId(shownId, 8)}.
              </p>

              {revoked ? (
                <p className="mt-2.5 max-w-3xl break-words text-[13px] leading-relaxed text-zinc-300">
                  The seller revoked the mandate, so the authorization is dead. Every charge the
                  agent tries from now on is refused by Prava with MANDATE_NOT_ACTIVE before it
                  reaches a card, and past charges stand as they are. Signing a fresh mandate is the
                  only way to let the agent spend again.
                </p>
              ) : (
                <p className="mt-2.5 max-w-3xl break-words text-[13px] leading-relaxed text-zinc-300">
                  The count runs out before the money does. A monthly mandate allows one charge per
                  cycle, so the second purchase in the same month is refused by Prava with the
                  ceiling untouched.{" "}
                  {read?.queued
                    ? `${read.queued} more signed ${read.queued === 1 ? "mandate is" : "mandates are"} queued behind this one, and the agent moves on instead of retrying this one.`
                    : "Once it is used the agent stops buying until another mandate is signed."}
                </p>
              )}

              {onRevoke && !revoked ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => {
                      if (!confirmRevoke) {
                        setConfirmRevoke(true);
                        return;
                      }
                      setConfirmRevoke(false);
                      onRevoke();
                    }}
                    className={`min-h-[2.5rem] rounded-lg border px-3 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      confirmRevoke
                        ? "border-rose-400/60 bg-rose-500/[0.18] text-rose-100 hover:bg-rose-500/[0.28]"
                        : "border-rose-400/30 bg-rose-500/[0.07] text-rose-200 hover:bg-rose-500/[0.14]"
                    }`}
                  >
                    {confirmRevoke ? "Click again to revoke for good" : "Stop the agent, revoke it"}
                  </button>
                  {confirmRevoke ? (
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(false)}
                      className="min-h-[2.5rem] rounded-lg px-2 text-[12px] font-medium text-zinc-400 hover:text-white"
                    >
                      Keep it
                    </button>
                  ) : (
                    <span className="text-[12px] leading-snug text-zinc-500">
                      Kills the authorization for good. The next purchase attempt is refused live.
                    </span>
                  )}
                  <p role="alert" className="sr-only">
                    {confirmRevoke
                      ? "Confirm needed. Press the same button again to revoke the mandate for good, or choose Keep it to cancel."
                      : ""}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="text-[14px] font-semibold text-white">
                No mandate on file, so the agent cannot spend a cent.
              </div>
              <p className="mt-1 max-w-3xl break-words text-[13px] leading-relaxed text-zinc-400">
                The seller signs a mandate with a passkey at Prava and that mandate is the leash: one
                charge per monthly cycle, a ceiling on that charge, one merchant, and an expiry date.
                Until it exists every purchase attempt is refused before it reaches a card.
                Everything below still runs, only the charge is off.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/[0.08] sm:grid-cols-4">
                <Field label="This cycle" value="Not set" hint="nothing is authorized" />
                <Field label="Most it can charge" value="Not set" hint={`$${money(cap)} planned`} />
                <Field label="Merchant" value="Not set" hint="Render credits only" />
                <Field label="Expires" value="Not set" hint="Set when signed" />
              </div>
            </>
          )}

          <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
            <Link
              href="/authorization"
              className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-white/25 bg-white/[0.10] px-3 text-[12px] font-semibold text-white transition-colors hover:border-white/40"
            >
              See what you authorized
            </Link>
            <Link
              href="/merchant-check"
              className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 text-[12px] font-semibold text-zinc-200 transition-colors hover:border-white/30 hover:text-white"
            >
              Watch a real store answer the protocol
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
