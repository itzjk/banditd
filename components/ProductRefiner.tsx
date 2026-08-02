"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import type { ProductOptions } from "@/lib/store";

const MAX_REFINEMENT = 60;
const SHOTS_KEY = "banditd_variant_shots";
const MAX_SHOTS = 12;

type Shots = Record<string, string>;

interface Patch {
  variant?: string;
  brand?: string;
  price?: string;
}

interface Props {
  productName: string;
  options: ProductOptions | null;
  loading: boolean;
  failed: boolean;
  variant: string;
  brand: string;
  price: string;
  disabled?: boolean;
  onChange: (patch: Patch) => void;
  onRetry: () => void;
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function shotKey(productName: string, variant: string): string {
  return `${productName.trim().toLowerCase()}|${variant.trim().toLowerCase()}`;
}

function restoreShots(): Shots {
  try {
    const raw = window.localStorage.getItem(SHOTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Shots = {};
    for (const [key, data] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof data === "string" && data.startsWith("data:image/")) out[key] = data;
    }
    return out;
  } catch {
    return {};
  }
}

function saveShots(shots: Shots) {
  const entries = Object.entries(shots);
  const kept = Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_SHOTS)));
  try {
    window.localStorage.setItem(SHOTS_KEY, JSON.stringify(kept));
  } catch {
    try {
      window.localStorage.removeItem(SHOTS_KEY);
    } catch {
      return;
    }
  }
}

function Pills({ widths }: { widths: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {widths.map((w, i) => (
        <span
          key={i}
          className={`h-11 animate-pulse rounded-full border border-white/10 bg-white/[0.05] ${w}`}
        />
      ))}
    </div>
  );
}

function Cards({ count }: { count: number }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="block animate-pulse rounded-xl bg-white/[0.05] pb-[100%]"
        />
      ))}
    </div>
  );
}

function evenly(options: string[], max: number): string[] {
  const capped = options.slice(0, max);
  if (capped.length <= 1) return capped;
  return capped.length % 2 === 0 ? capped : capped.slice(0, capped.length - 1);
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
        on ? "border-white bg-white text-zinc-950" : "border-white/30 bg-transparent text-transparent"
      }`}
    >
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5">
        <path
          d="M3.5 8.5l3 3 6-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Group({
  title,
  hint,
  placeholder,
  productName,
  options,
  value,
  loading,
  visual,
  shots,
  pending,
  disabled,
  onPick,
}: {
  title: string;
  hint: string;
  placeholder: string;
  productName: string;
  options: string[];
  value: string;
  loading: boolean;
  visual?: boolean;
  shots?: Shots;
  pending?: Set<string>;
  disabled?: boolean;
  onPick: (next: string) => void;
}) {
  const field = useId();
  const [draft, setDraft] = useState("");

  const listed = options.some((o) => same(o, value));
  const custom = value !== "" && !listed;

  const pick = (option: string) => {
    setDraft("");
    onPick(same(option, value) ? "" : option);
  };

  const commit = () => {
    const clean = draft.trim().slice(0, MAX_REFINEMENT);
    if (!clean) return;
    setDraft("");
    onPick(clean);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    commit();
  };

  const pill = (option: string, on: boolean) => (
    <button
      key={option}
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => pick(option)}
      className={`min-h-[2.75rem] max-w-full break-words rounded-full border px-3 py-2 text-left text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? "border-white bg-white text-zinc-950 hover:bg-zinc-200"
          : "border-white/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.1]"
      }`}
    >
      {option}
    </button>
  );

  const card = (option: string, on: boolean) => {
    const shot = shots?.[shotKey(productName, option)] ?? null;
    const drawing = pending?.has(shotKey(productName, option)) ?? false;
    return (
      <button
        key={option}
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => pick(option)}
        className={`flex min-w-0 flex-col overflow-hidden rounded-xl border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          on
            ? "border-white bg-white/[0.12]"
            : "border-white/15 bg-white/[0.03] hover:bg-white/[0.09]"
        }`}
      >
        <span className="relative block aspect-square w-full overflow-hidden bg-zinc-900">
          {shot ? (
            <Image
              src={shot}
              alt={`${option} ${productName}`}
              fill
              unoptimized
              sizes="(max-width: 640px) 45vw, 220px"
              className="object-cover"
            />
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.10] to-transparent px-1 text-center ${
                drawing ? "animate-pulse" : ""
              }`}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-300">
                {drawing ? "Drawing it" : "No photo"}
              </span>
            </span>
          )}
        </span>
        <span className="flex min-h-[2.75rem] items-start gap-1.5 px-2 py-2">
          <Tick on={on} />
          <span
            className={`min-w-0 break-words text-[12px] font-semibold leading-snug ${
              on ? "text-white" : "text-zinc-200"
            }`}
          >
            {option}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="t-small font-semibold text-white">{title}</h3>
        {value ? (
          <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-200">
            Set
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 break-words text-[12px] leading-snug text-zinc-400">{hint}</p>

      {loading ? (
        visual ? (
          <Cards count={4} />
        ) : (
          <Pills widths={["w-28", "w-36", "w-24", "w-32"]} />
        )
      ) : visual ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {evenly(custom ? [value, ...options] : options, 4).map((option) =>
            card(option, same(option, value)),
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((option) => pill(option, same(option, value)))}
          {custom ? pill(value, true) : null}
        </div>
      )}

      <form onSubmit={submit} className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label htmlFor={field} className="sr-only">
          {title}, type your own
        </label>
        <input
          id={field}
          type="text"
          value={draft}
          maxLength={MAX_REFINEMENT}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
          }}
          placeholder={placeholder}
          className="min-h-[2.75rem] w-full min-w-0 rounded-xl bg-white/[0.03] px-3 py-2 text-[14px] text-white placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={disabled || draft.trim().length === 0}
          className="min-h-[2.75rem] shrink-0 rounded-xl border border-white/25 bg-white/[0.08] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          Use this
        </button>
      </form>
    </div>
  );
}

export default function ProductRefiner({
  productName,
  options,
  loading,
  failed,
  variant,
  brand,
  price,
  disabled,
  onChange,
  onRetry,
}: Props) {
  const [shots, setShots] = useState<Shots>(() =>
    typeof window === "undefined" ? {} : restoreShots(),
  );
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const asked = useRef<Set<string>>(new Set());

  const settle = useCallback((key: string) => {
    setPending((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const wanted = options?.variants ?? [];
    if (!productName || wanted.length === 0) return;

    const missing = wanted.filter((v) => {
      const key = shotKey(productName, v);
      return !shots[key] && !asked.current.has(key);
    });
    if (missing.length === 0) return;

    missing.forEach((v) => asked.current.add(shotKey(productName, v)));
    setPending((prev) => {
      const next = new Set(prev);
      missing.forEach((v) => next.add(shotKey(productName, v)));
      return next;
    });

    missing.forEach((v) => {
      const key = shotKey(productName, v);
      const draw = async () => {
        try {
          const res = await fetch("/api/refine/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productName, variant: v }),
            cache: "no-store",
          });
          if (!res.ok) return;
          const data = (await res.json()) as { imageData?: unknown };
          if (typeof data.imageData !== "string") return;
          setShots((prev) => {
            const merged = { ...prev, [key]: data.imageData as string };
            saveShots(merged);
            return merged;
          });
        } catch {
          return;
        } finally {
          settle(key);
        }
      };
      void draw();
    });
  }, [productName, options, shots, settle]);

  const range = options?.priceRange ?? null;
  const priceSet = Boolean(range && price && same(price, range.recommended));
  const chosen = [variant, brand].filter((v) => v.length > 0);

  return (
    <div className="min-w-0">
      {failed ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[12px] leading-snug text-zinc-300">
          <span className="min-w-0 break-words">
            The suggestions did not come back this time. You can still type the variant and the
            brand yourself.
          </span>
          <button
            type="button"
            onClick={onRetry}
            disabled={disabled}
            className="min-h-[2.75rem] shrink-0 rounded-lg border border-white/20 bg-white/[0.06] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="grid gap-4">
        <Group
          title="Variant or material"
          hint="Point at the one you sell. Tap it again to clear it."
          placeholder="Type your own variant"
          productName={productName}
          options={options?.variants ?? []}
          value={variant}
          loading={loading}
          visual
          shots={shots}
          pending={pending}
          disabled={disabled}
          onPick={(next) => onChange({ variant: next })}
        />
        <Group
          title="Brand"
          hint="Yours, or the one you are measured against."
          placeholder="Type your own brand"
          productName={productName}
          options={options?.brands ?? []}
          value={brand}
          loading={loading}
          disabled={disabled}
          onPick={(next) => onChange({ brand: next })}
        />
      </div>

      {range ? (
        <div className="mt-3 rounded-xl border border-white/12 bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="t-small font-semibold text-white">What it usually sells for</h3>
            <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-200">
              Estimate
            </span>
          </div>
          <p className="mt-1 break-words text-[12px] leading-snug text-zinc-400">
            This is the model reading the category. Nothing was looked up.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[14px] font-semibold tabular-nums text-white">
              {range.low} to {range.high}
            </span>
            <button
              type="button"
              onClick={() => onChange({ price: range.recommended })}
              disabled={disabled || priceSet}
              className="min-h-[2.75rem] rounded-xl border border-white/25 bg-white/[0.08] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {priceSet ? `Price set to ${range.recommended}` : `Use ${range.recommended}`}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
        <p className="min-w-0 break-words text-[12px] leading-snug text-zinc-400">
          {chosen.length === 0
            ? loading
              ? "Reading the category for its usual builds, brands and prices."
              : "Nothing picked, so the run reads the whole category."
            : `The run aims at ${chosen.join(", ")}.`}
        </p>
        {chosen.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange({ variant: "", brand: "" })}
            disabled={disabled}
            className="min-h-[2.75rem] shrink-0 px-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear both
          </button>
        ) : null}
      </div>
    </div>
  );
}
