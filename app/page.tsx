"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { State } from "@/lib/store";

const STORAGE_KEY = "banditd_state";

function saveState(value: State) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...value,
        creatives: (value.creatives ?? []).map((c) => ({ ...c, imageData: null })),
      }),
    );
  } catch {
    return;
  }
}

const EXAMPLE = {
  name: "Cold-Pressed Coffee Concentrate",
  price: "$28.00",
  description: "A 32oz bottle of slow-steeped concentrate that makes 16 cups.",
};

const STEPS = [
  {
    n: "01",
    title: "Researches the market",
    body: "Web search on who buys this, what competitors claim, and where your price lands.",
  },
  {
    n: "02",
    title: "Writes four creatives",
    body: "Four angles, four images, four sets of copy. Price, ritual, gift, quality.",
  },
  {
    n: "03",
    title: "Measures which one wins",
    body: "Each creative is an arm on a multi-armed bandit, scored with Thompson sampling.",
  },
  {
    n: "04",
    title: "Buys its own credits",
    body: "At 95% confidence it charges more render credits through Prava, with no approval step.",
  },
];

const GUARDRAILS = ["Max spend", "Allowed merchant", "Expiry date", "Revocable anytime"];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function fillExample() {
    setName(EXAMPLE.name);
    setPrice(EXAMPLE.price);
    setDescription(EXAMPLE.description);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price, description }),
      });
      const data = (await res.json().catch(() => null)) as (State & { error?: string }) | null;
      if (!res.ok) {
        setError(data?.error ?? "Could not save the product. Try again.");
        setBusy(false);
        return;
      }
      if (data) saveState(data);
      router.push("/dashboard");
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="grid-bg flex min-h-full flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-gutter py-4">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">banditd</span>
            <span className="hidden text-sm text-subtle sm:inline">ad agent</span>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted">
            <span className="size-1.5 rounded-full bg-accent" />
            Prava sandbox
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-gutter pb-16 pt-10 sm:pt-14">
        <div className="max-w-2xl">
          <p className="eyebrow">Agentic commerce</p>
          <h1 className="mt-3 text-display font-semibold">
            An agent that runs your ads and spends its own money on the ones that work.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Give it a product. It researches the market, generates the creatives, watches which
            one actually wins, and once the evidence is statistical it buys more render credits
            by itself through Prava, inside the limits you set.
          </p>
        </div>

        <div className="mt-10 grid gap-10 lg:mt-14 lg:grid-cols-[1fr_minmax(0,26rem)] lg:gap-12">
          <section className="order-2 lg:order-1">
            <ol className="space-y-6">
              {STEPS.map((step) => (
                <li key={step.n} className="flex gap-4">
                  <span className="mt-0.5 font-mono text-xs font-medium text-accent">
                    {step.n}
                  </span>
                  <div>
                    <h2 className="text-[0.95rem] font-semibold tracking-tight">{step.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-8 border-t border-border pt-6">
              <p className="eyebrow">The limits you set</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {GUARDRAILS.map((g) => (
                  <span
                    key={g}
                    className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted"
                  >
                    {g}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                Go over the mandate and the charge is blocked, with the reason written to the
                dashboard. The card number never touches the agent.
              </p>
            </div>
          </section>

          <section className="order-1 lg:order-2">
            <div className="card p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Start with a product</h2>
                  <p className="mt-1 text-sm text-muted">Name, price, one line about it.</p>
                </div>
                <button
                  type="button"
                  onClick={fillExample}
                  className="shrink-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                  Use example
                </button>
              </div>

              <form onSubmit={onSubmit} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                    Product name
                  </label>
                  <input
                    id="name"
                    name="name"
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Cold-Pressed Coffee Concentrate"
                    autoComplete="off"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="price" className="mb-1.5 block text-sm font-medium">
                    Price
                  </label>
                  <input
                    id="price"
                    name="price"
                    className="field"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="$28.00"
                    inputMode="decimal"
                    autoComplete="off"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="description" className="mb-1.5 block text-sm font-medium">
                    One line about it
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    className="field resize-none"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="A 32oz bottle of slow-steeped concentrate that makes 16 cups."
                    required
                  />
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Handing it to the agent" : "Hand it to the agent"}
                </button>

                <p className="text-xs leading-relaxed text-subtle">
                  Performance numbers in the demo are simulated and labeled in the dashboard.
                  Payments run against the Prava sandbox.
                </p>
              </form>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-gutter py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <span>Built at the Agentic Commerce Hackathon, 2026.</span>
          <span className="font-mono">OpenAI and Prava on Visa Intelligent Commerce</span>
        </div>
      </footer>
    </div>
  );
}
