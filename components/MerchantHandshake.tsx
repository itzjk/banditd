"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogOutcome, Discovery } from "@/lib/ucp";

export interface MerchantHandshakeResponse {
  ok: boolean;
  domain: string;
  profileUrl: string;
  summary: string;
  purchased: false;
  ms: number;
  discovery: Discovery;
  catalog: CatalogOutcome | null;
}

export interface Props {
  domains?: string[];
  defaultDomain?: string;
  defaultQuery?: string;
  endpoint?: string;
  className?: string;
}

export const VERIFIED_DOMAINS = ["allbirds.com", "decathlon.com", "littleboxindia.com"];

function shortUrl(url: string, keep = 46): string {
  const bare = url.replace(/^https?:\/\//, "");
  return bare.length > keep ? `${bare.slice(0, keep)}...` : bare;
}

function capabilityLabel(name: string): string {
  return name.replace(/^dev\.ucp\./, "").replace(/^dev\./, "");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border pt-2 sm:flex-row sm:gap-3">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-subtle sm:w-28">{label}</span>
      <span className="min-w-0 break-all text-xs text-foreground">{children}</span>
    </div>
  );
}

const TONES = {
  good: "border-[color:var(--accent)]/35 bg-[color:var(--accent-soft)]",
  warn: "border-[color:var(--warn)]/35 bg-[color:var(--warn-soft)]",
  bad: "border-[color:var(--danger)]/35 bg-[color:var(--danger-soft)]",
};

function Verdict({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <p className={`rounded-lg border px-3 py-2 text-xs leading-relaxed text-foreground ${TONES[tone]}`}>
      {children}
    </p>
  );
}

export default function MerchantHandshake({
  domains = VERIFIED_DOMAINS,
  defaultDomain = VERIFIED_DOMAINS[0],
  defaultQuery = "best seller",
  endpoint = "/api/merchant",
  className = "",
}: Props) {
  const [domain, setDomain] = useState(defaultDomain);
  const [query, setQuery] = useState(defaultQuery);
  const [data, setData] = useState<MerchantHandshakeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  const greet = useCallback(
    async (target: string) => {
      const clean = target.trim();
      if (!clean) return;

      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;

      setBusy(true);
      setError(null);

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: clean, query }),
          signal: controller.signal,
        });
        const body = (await res.json()) as MerchantHandshakeResponse & { message?: string };
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setData(null);
          setError(body.message ?? "That request did not make it out.");
          return;
        }

        setData(body);
      } catch (err) {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : "The check could not run.");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [endpoint, query],
  );

  useEffect(() => () => inflight.current?.abort(), []);

  const profile = data && data.discovery.ok ? data.discovery.profile : null;
  const failure = data && !data.discovery.ok ? data.discovery : null;
  const catalog = data?.catalog ?? null;

  return (
    <section
      className={`w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-surface p-3 sm:p-5 ${className}`}
    >
      <p className="eyebrow">Live protocol check</p>
      <h2 className="mt-1 text-lg font-semibold leading-tight sm:text-xl">
        The agent introduces itself to a real store
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">
        banditd reads the store profile at <span className="break-all">/.well-known/ucp</span>, sends its own
        published agent profile so the store can identify who is calling, and asks the catalog for a price. Every
        field below came back from that store just now.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {domains.map((item) => (
          <button
            key={item}
            type="button"
            disabled={busy}
            onClick={() => {
              setDomain(item);
              void greet(item);
            }}
            className={`inline-flex min-h-[2.75rem] items-center rounded-full border px-3 text-[11px] transition disabled:opacity-50 ${
              domain === item ? "border-border-strong bg-surface-2 font-medium" : "border-border text-muted"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void greet(domain);
        }}
      >
        <input
          className="field min-w-0 flex-1"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="allbirds.com"
          aria-label="Store domain"
          spellCheck={false}
          autoCapitalize="off"
        />
        <input
          className="field min-w-0 sm:w-40"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="best seller"
          aria-label="Catalog query"
        />
        <button
          type="submit"
          disabled={busy || !domain.trim()}
          className="min-h-[2.75rem] shrink-0 rounded-lg border border-border-strong bg-surface-2 px-4 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Saying hello" : "Say hello"}
        </button>
      </form>

      {error ? <p className="mt-3 text-xs text-[color:var(--danger)]">{error}</p> : null}

      {data ? (
        <div className="mt-4 space-y-3">
          <Verdict tone={!data.ok ? "bad" : catalog && !catalog.ok ? "warn" : "good"}>
            {data.summary}
          </Verdict>

          <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[11px] uppercase tracking-wide text-subtle">What the store answered</p>
            <Row label="Profile read">
              {shortUrl(profile ? profile.resolvedUrl : `https://${data.domain}/.well-known/ucp`)}
            </Row>
            {profile ? (
              <>
                <Row label="UCP version">{profile.version ?? "not declared"}</Row>
                <Row label="Transports">
                  {profile.transports.length
                    ? profile.transports.map((t) => t.transport).join(", ")
                    : "none declared"}
                </Row>
                <Row label="MCP endpoint">{profile.mcpEndpoint ? shortUrl(profile.mcpEndpoint) : "none"}</Row>
                <Row label="Capabilities">
                  <span className="flex flex-wrap gap-1">
                    {profile.capabilities.length ? (
                      profile.capabilities.map((cap) => (
                        <span
                          key={cap.name}
                          className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]"
                        >
                          {capabilityLabel(cap.name)}
                        </span>
                      ))
                    ) : (
                      <span>none declared</span>
                    )}
                  </span>
                </Row>
                <Row label="Payment">
                  {profile.paymentHandlers.length ? profile.paymentHandlers.join(", ") : "none declared"}
                </Row>
              </>
            ) : (
              <Row label="Reason">{failure?.detail ?? "no answer"}</Row>
            )}
            <Row label="Round trip">{data.ms} ms</Row>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[11px] uppercase tracking-wide text-subtle">
              Who the store thinks is calling
            </p>
            <Row label="Agent profile">{shortUrl(data.profileUrl, 52)}</Row>
            <p className="text-xs leading-relaxed text-muted">
              The store fetches that file before it answers. It declares catalog search and catalog lookup and
              nothing else. No cart, no checkout, no payment handler.
            </p>
          </div>

          {catalog ? (
            <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
              <p className="text-[11px] uppercase tracking-wide text-subtle">
                Catalog search for {catalog.query}
              </p>
              {catalog.ok ? (
                <ul className="space-y-1.5">
                  {catalog.products.map((product) => (
                    <li
                      key={product.id}
                      className="flex flex-col gap-0.5 border-t border-border pt-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                    >
                      <span className="min-w-0 break-words text-xs text-foreground">{product.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {product.price ?? "no price"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs leading-relaxed text-muted">
                  {catalog.detail}
                  {catalog.code ? <span className="text-subtle"> ({catalog.code})</span> : null}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
        <span className="font-medium text-foreground">Nothing is bought here.</span> banditd does not place an
        order at this store and no card is ever presented to it. This panel proves one thing only: the agent
        speaks the protocol that real stores publish, and a real store accepts it as a caller. The charge in the
        demo runs against the render credit merchant on Prava, which is stated as a stand in wherever it appears.
      </p>
    </section>
  );
}
