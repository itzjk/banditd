"use client";

import { useState } from "react";

const STORAGE_KEY = "banditd_state";

function forget() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [clearing, setClearing] = useState(false);

  const startClean = () => {
    setClearing(true);
    forget();
    window.location.href = "/";
  };

  return (
    <div className="grid-bg flex min-h-full flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-gutter py-12 sm:py-16">
        <div className="card p-5 sm:p-6">
          <p className="eyebrow">Something went wrong</p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">
            This page stopped before it finished loading
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Nothing was charged and no mandate was touched. Try again first. If the page keeps
            failing, the run saved in this browser is damaged, and clearing it starts a fresh run
            from the home page.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              disabled={clearing}
              className="w-full rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={startClean}
              disabled={clearing}
              className="w-full rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm font-semibold text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {clearing ? "Clearing" : "Clear the saved run and restart"}
            </button>
          </div>

          {error.digest ? (
            <p className="mt-4 font-mono text-xs break-all text-subtle">
              Reference {error.digest}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
