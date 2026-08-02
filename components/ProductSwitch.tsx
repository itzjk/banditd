"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/store";
import { searchCatalog, type CatalogProduct } from "@/lib/catalog";

interface Props {
  product: Product;
  hasRun: boolean;
  disabled?: boolean;
  onApply: (
    next: { name: string; price: string; description: string },
    restart: boolean,
  ) => void;
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function ProductSwitch({ product, hasRun, disabled, onApply }: Props) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(product.price);
  const [description, setDescription] = useState(product.description);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => (suggestOpen ? searchCatalog(name) : []), [suggestOpen, name]);
  const listOpen = suggestOpen && matches.length > 0;
  const renames = norm(name) !== norm(product.name);

  useEffect(() => {
    if (!listOpen) return;
    function onDown(event: MouseEvent) {
      const node = comboRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setSuggestOpen(false);
        setActive(-1);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [listOpen]);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
  }, [open]);

  const start = () => {
    setName(product.name);
    setPrice(product.price);
    setDescription(product.description);
    setError(null);
    setConfirming(false);
    setSuggestOpen(false);
    setActive(-1);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setConfirming(false);
    setError(null);
    setSuggestOpen(false);
    setActive(-1);
  };

  const pick = (item: CatalogProduct) => {
    setName(item.name);
    setPrice(item.price);
    setDescription(item.description);
    setSuggestOpen(false);
    setActive(-1);
    setError(null);
    setConfirming(false);
  };

  const onNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (!listOpen) return;
      e.preventDefault();
      setSuggestOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!listOpen) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const total = matches.length;
      setActive((current) => {
        if (current < 0) return step === 1 ? 0 : total - 1;
        return (current + step + total) % total;
      });
      return;
    }
    if (e.key === "Enter" && listOpen && active >= 0) {
      e.preventDefault();
      pick(matches[active]);
      return;
    }
    if (e.key === "Tab" && listOpen) {
      setSuggestOpen(false);
      setActive(-1);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const clean = {
      name: name.trim(),
      price: price.trim(),
      description: description.trim(),
    };
    if (!clean.name || !clean.price || !clean.description) {
      setError("The name, the price and the description all have to say something.");
      return;
    }
    const restart = norm(clean.name) !== norm(product.name);
    if (!restart && clean.price === product.price && clean.description === product.description) {
      close();
      return;
    }
    if (restart && hasRun && !confirming) {
      setConfirming(true);
      setError(null);
      return;
    }
    onApply(clean, restart);
    close();
  };

  const consequence = !renames
    ? "The price and the description are corrected in place. The ads, the traffic and the evidence behind them stay exactly where they are."
    : hasRun
      ? `A different name is a different product, so the run starts over: four new ads, no traffic and no evidence. This run is archived under Earlier runs before ${product.name} leaves the board.`
      : "A different name starts the run over. Nothing has run yet, so nothing is lost.";

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        className="inline-flex min-h-[2.75rem] items-center rounded-xl border border-white/20 bg-white/[0.06] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Change the product
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="min-w-0">
      <h3 className="t-small font-semibold text-white">Change the product</h3>
      <p className="mt-0.5 break-words text-[12px] leading-snug text-zinc-400">
        Type a name and the catalog fills the rest, typos and all.
      </p>

      <div className="mt-2 space-y-3">
        <div ref={comboRef} className="relative">
          <label htmlFor={`${ids}-name`} className="block text-[12px] font-semibold text-zinc-300">
            Product name
          </label>
          <input
            id={`${ids}-name`}
            ref={nameRef}
            type="text"
            value={name}
            disabled={disabled}
            onChange={(e) => {
              setName(e.target.value);
              setSuggestOpen(true);
              setActive(-1);
              setError(null);
              setConfirming(false);
            }}
            onFocus={() => setSuggestOpen(true)}
            onClick={() => setSuggestOpen(true)}
            onKeyDown={onNameKeyDown}
            placeholder="Start typing, try air"
            autoComplete="off"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={`${ids}-suggestions`}
            aria-autocomplete="list"
            aria-activedescendant={
              listOpen && active >= 0 ? `${ids}-suggestion-${active}` : undefined
            }
            className="mt-1 min-h-[2.75rem] w-full min-w-0 rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-[14px] text-white placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-40"
          />
          <ul
            id={`${ids}-suggestions`}
            role="listbox"
            aria-label="Product suggestions"
            hidden={!listOpen}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-white/20 bg-zinc-900 py-1 shadow-xl"
          >
            {matches.map((item, index) => (
              <li
                key={item.name}
                id={`${ids}-suggestion-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
                onMouseMove={() => setActive(index)}
                className={`cursor-pointer px-3 py-2.5 ${index === active ? "bg-white/10" : ""}`}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 break-words text-[13px] font-semibold text-white">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-zinc-400">
                    {item.price}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] leading-snug text-zinc-400">
                  {item.description}
                </span>
              </li>
            ))}
          </ul>
          <p aria-live="polite" className="sr-only">
            {listOpen
              ? `${matches.length} ${matches.length === 1 ? "suggestion" : "suggestions"} available`
              : ""}
          </p>
        </div>

        <div>
          <label htmlFor={`${ids}-price`} className="block text-[12px] font-semibold text-zinc-300">
            Price
          </label>
          <input
            id={`${ids}-price`}
            type="text"
            value={price}
            disabled={disabled}
            onChange={(e) => {
              setPrice(e.target.value);
              setError(null);
            }}
            placeholder="$34.00"
            className="mt-1 min-h-[2.75rem] w-full min-w-0 rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-[14px] tabular-nums text-white placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>

        <div>
          <label htmlFor={`${ids}-about`} className="block text-[12px] font-semibold text-zinc-300">
            Description
          </label>
          <textarea
            id={`${ids}-about`}
            rows={3}
            value={description}
            disabled={disabled}
            onChange={(e) => {
              setDescription(e.target.value);
              setError(null);
            }}
            placeholder="What it is and who it is for, in a line."
            className="mt-1 w-full min-w-0 resize-y rounded-xl border border-white/15 bg-white/[0.03] px-3 py-2 text-[14px] leading-relaxed text-white placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      </div>

      <p
        aria-live="polite"
        className={`mt-3 break-words rounded-xl border px-3 py-2 text-[12px] leading-relaxed ${
          renames && hasRun
            ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
            : "border-white/12 bg-white/[0.03] text-zinc-300"
        }`}
      >
        {consequence}
      </p>

      {error ? (
        <p className="mt-2 break-words rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={disabled}
          className={`min-h-[2.75rem] rounded-xl px-5 text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            confirming
              ? "border border-amber-400/50 bg-amber-400/20 text-amber-100 hover:bg-amber-400/30"
              : "bg-white text-zinc-950 hover:bg-zinc-200"
          }`}
        >
          {confirming ? "Yes, start over on the new product" : "Save the product"}
        </button>
        <button
          type="button"
          onClick={close}
          className="min-h-[2.75rem] rounded-xl border border-white/15 bg-white/[0.03] px-5 text-[14px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
