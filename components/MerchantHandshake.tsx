"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CapabilityDecision,
  CatalogOutcome,
  Discovery,
  Negotiation,
  PaymentDecision,
} from "@/lib/ucp";

export interface MerchantHandshakeResponse {
  ok: boolean;
  domain: string;
  profileUrl: string;
  agentVersion: string;
  summary: string;
  purchased: false;
  ms: number;
  discovery: Discovery;
  negotiation: Negotiation | null;
  capabilities: CapabilityDecision[];
  payment: PaymentDecision | null;
  catalog: CatalogOutcome | null;
}

export interface Props {
  domains?: string[];
  defaultDomain?: string;
  defaultQuery?: string;
  endpoint?: string;
  className?: string;
}

export const DEMO_DOMAINS = [
  "allbirds.com",
  "gymshark.com",
  "decathlon.com",
  "littleboxindia.com",
  "example.com",
];

const NEVER_SENT = new Set([
  "no_endpoint",
  "capability_absent",
  "version_unsupported",
  "version_not_declared",
  "version_profile_error",
]);

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
      <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-subtle sm:w-28">{label}</span>
      <span className="min-w-0 break-all text-xs text-foreground">{children}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">{title}</p>
      {children}
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

const MARKS: Record<CapabilityDecision["verdict"], { mark: string; label: string; className: string }> = {
  called: { mark: "+", label: "called", className: "text-[color:var(--accent)]" },
  absent: { mark: "!", label: "not offered", className: "text-[color:var(--warn)]" },
  declined: { mark: "-", label: "declined", className: "text-subtle" },
};

function DecisionLine({ decision }: { decision: CapabilityDecision }) {
  const mark = MARKS[decision.verdict];
  return (
    <li className="flex gap-2 border-t border-border pt-1.5">
      <span className={`w-3 shrink-0 text-xs font-medium tabular-nums ${mark.className}`}>{mark.mark}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-all text-xs text-foreground">{capabilityLabel(decision.name)}</span>
          <span className={`text-[10px] uppercase tracking-[0.12em] ${mark.className}`}>{mark.label}</span>
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{decision.why}</span>
      </span>
    </li>
  );
}

export default function MerchantHandshake({
  domains = DEMO_DOMAINS,
  defaultDomain = DEMO_DOMAINS[0],
  defaultQuery = "best seller",
  endpoint = "/api/merchant",
  className = "",
}: Props) {
  const [domain, setDomain] = useState(defaultDomain);
  const [query, setQuery] = useState(defaultQuery);
  const [pinned, setPinned] = useState<string | null>(null);
  const [data, setData] = useState<MerchantHandshakeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  const greet = useCallback(
    async (target: string, version: string | null) => {
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
          body: JSON.stringify({ domain: clean, query, version }),
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
  const negotiation = data?.negotiation ?? null;
  const decisions = data?.capabilities ?? [];
  const declined = decisions.filter((d) => d.verdict !== "called");
  const called = decisions.find((d) => d.verdict === "called") ?? null;
  const offered = negotiation?.offered ?? [];
  const sent = !!catalog && (catalog.ok || !NEVER_SENT.has(catalog.reason));

  return (
    <section
      className={`w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-surface p-3 sm:p-5 ${className}`}
    >
      <p className="eyebrow">Live protocol check</p>
      <h1 className="t-headline mt-1">The agent reads a real store and acts on what it read</h1>
      <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">
        banditd reads the store profile at <span className="break-all">/.well-known/ucp</span>, picks a protocol
        version both sides declare, and only calls a capability the store actually advertises at that version.
        Everything below is the run shown here, including the calls it chose not to make.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {domains.map((item) => (
          <button
            key={item}
            type="button"
            disabled={busy}
            onClick={() => {
              setDomain(item);
              setPinned(null);
              void greet(item, null);
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
          void greet(domain, pinned);
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
          {busy ? "Reading" : "Read the store"}
        </button>
      </form>

      {offered.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-[0.14em] text-subtle">Run at version</span>
          {[null, ...offered].map((version) => (
            <button
              key={version ?? "auto"}
              type="button"
              disabled={busy}
              onClick={() => {
                setPinned(version);
                void greet(domain, version);
              }}
              className={`inline-flex min-h-[2.25rem] items-center rounded-full border px-2.5 text-[11px] transition disabled:opacity-50 ${
                pinned === version ? "border-border-strong bg-surface-2 font-medium" : "border-border text-muted"
              }`}
            >
              {version ?? "negotiated"}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-[color:var(--danger)]">{error}</p> : null}

      {data ? (
        <div className="mt-4 space-y-3">
          <Verdict tone={!data.ok ? "bad" : catalog && !catalog.ok ? "warn" : "good"}>{data.summary}</Verdict>

          {negotiation ? (
            <Block title="Version negotiation">
              <Row label="Store offers">{negotiation.offered.join(", ") || "one version only"}</Row>
              <Row label="Agent declares">{negotiation.agentVersion}</Row>
              <Row label="Chosen">
                {negotiation.chosen ? (
                  <span>
                    {negotiation.chosen}
                    {negotiation.pinned ? " (pinned for this run)" : ""}
                  </span>
                ) : (
                  "none in common"
                )}
              </Row>
              {negotiation.rejected.length ? (
                <Row label="Set aside">
                  <span className="flex flex-col gap-0.5">
                    {negotiation.rejected.map((item) => (
                      <span key={item.version}>
                        {item.version}: <span className="text-muted">{item.why}</span>
                      </span>
                    ))}
                  </span>
                </Row>
              ) : null}
              <Row label="Read from">{shortUrl(negotiation.profileUrl, 52)}</Row>
              {negotiation.confirmedVersion ? (
                <Row label="Store confirmed">
                  {negotiation.confirmedVersion}
                  {negotiation.confirmedVersion === negotiation.chosen
                    ? " in its answer"
                    : `, which is not the ${negotiation.chosen} this agent sent`}
                </Row>
              ) : null}
              <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted">
                {negotiation.detail}{" "}
                {sent
                  ? "The chosen version travelled in the call, in the same meta block that carries the agent profile URL."
                  : "No call was made under it, so nothing was sent on the wire for this run."}
              </p>
            </Block>
          ) : null}

          {decisions.length ? (
            <Block title="What it did with what it found">
              <ul className="space-y-1.5">
                {decisions.map((decision) => (
                  <DecisionLine key={`${decision.verdict}-${decision.name}`} decision={decision} />
                ))}
              </ul>
              <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted">
                {called
                  ? `One capability was called. ${declined.length} of the ${decisions.length} on this list were not, and each line says why.`
                  : `Nothing was called. All ${decisions.length} lines on this list say why.`}
              </p>
            </Block>
          ) : null}

          {data.payment ? (
            <Block title="Payment, and where this agent stops">
              <Row label="Store offers">
                {data.payment.offered.length ? data.payment.offered.join(", ") : "none declared"}
              </Row>
              <Row label="Agent declares">
                {data.payment.declared.length ? data.payment.declared.join(", ") : "payment_handlers: {}"}
              </Row>
              <Row label="In common">
                {data.payment.matched.length ? data.payment.matched.join(", ") : "nothing"}
              </Row>
              <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted">
                {data.payment.why} That limit is published, not claimed here: the profile at{" "}
                <span className="break-all">{shortUrl(data.profileUrl, 52)}</span> is the file this agent points
                every store at, and it says this agent only reads against UCP businesses.
              </p>
            </Block>
          ) : null}

          <Block title="What the store answered">
            <Row label="Profile read">
              {shortUrl(profile ? profile.resolvedUrl : `https://${data.domain}/.well-known/ucp`)}
            </Row>
            {profile ? (
              <>
                <Row label="Current version">{profile.version ?? "not declared"}</Row>
                <Row label="Transports">
                  {profile.transports.length
                    ? profile.transports.map((t) => t.transport).join(", ")
                    : "none declared"}
                </Row>
                <Row label="MCP endpoint">{profile.mcpEndpoint ? shortUrl(profile.mcpEndpoint) : "none"}</Row>
              </>
            ) : (
              <Row label="Reason">{failure?.detail ?? "no answer"}</Row>
            )}
            <Row label="Round trip">{data.ms} ms</Row>
          </Block>

          {catalog ? (
            <Block title={`Catalog search for ${catalog.query}`}>
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
                  <span className="text-foreground">
                    {NEVER_SENT.has(catalog.reason) ? "Not sent." : "Sent and failed."}
                  </span>{" "}
                  {catalog.detail}
                  {catalog.code ? <span className="text-subtle"> ({catalog.code})</span> : null}
                </p>
              )}
            </Block>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
        <span className="font-medium text-foreground">Nothing is bought here.</span> banditd does not place an
        order at this store and no card is presented to it. This panel shows one thing only: the agent speaks the
        protocol that real stores publish, and what it read decided what it called. The charge in the demo runs
        against the render credit merchant on Prava, which is stated as a stand in wherever it appears.
      </p>
    </section>
  );
}
