"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Product, ProductOptions } from "@/lib/store";
import ProductRefiner from "@/components/ProductRefiner";
import ProductSwitch from "@/components/ProductSwitch";

interface Props {
  product: Product;
  options: ProductOptions | null;
  optionsLoading: boolean;
  optionsFailed: boolean;
  refinable: boolean;
  hasRun: boolean;
  disabled?: boolean;
  onRefine: (patch: { variant?: string; brand?: string; price?: string }) => void;
  onRetryOptions: () => void;
  onApply: (
    next: { name: string; price: string; description: string },
    restart: boolean,
  ) => void;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M4 6.5L8 10.5l4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ProductBar({
  product,
  options,
  optionsLoading,
  optionsFailed,
  refinable,
  hasRun,
  disabled,
  onRefine,
  onRetryOptions,
  onApply,
}: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      const node = wrapRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  const shut = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const aimed = [product.variant, product.brand].filter((v) => v && v.length > 0);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open || e.defaultPrevented) return;
        e.preventDefault();
        shut();
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 break-words text-[19px] font-semibold leading-tight tracking-tight text-white [overflow-wrap:anywhere] sm:text-xl">
          {product.name}
        </h1>

        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Close the product settings" : "Change the product, the variant or the brand"}
          onClick={() => setOpen((was) => !was)}
          className="-my-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Chevron open={open} />
        </button>

        <span className="shrink-0 text-[15px] font-medium tabular-nums text-zinc-300">
          {product.price}
        </span>

        {aimed.length > 0 ? (
          <span className="min-w-0 truncate text-[13px] text-zinc-400">{aimed.join(", ")}</span>
        ) : null}
      </div>

      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-label="Product settings"
          className="absolute left-0 top-full z-40 mt-2 max-h-[min(70vh,32rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-zinc-900 p-3 shadow-2xl focus:outline-none"
        >
          <div className="space-y-3">
            {refinable ? (
              <ProductRefiner
                productName={product.name}
                options={options}
                loading={optionsLoading}
                failed={optionsFailed}
                variant={product.variant ?? ""}
                brand={product.brand ?? ""}
                price={product.price}
                disabled={disabled}
                onChange={onRefine}
                onRetry={onRetryOptions}
              />
            ) : null}

            <div className={refinable ? "border-t border-white/10 pt-3" : ""}>
              <ProductSwitch
                product={product}
                hasRun={hasRun}
                disabled={disabled}
                onApply={(next, restart) => {
                  onApply(next, restart);
                  setOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
