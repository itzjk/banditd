import agentProfile from "@/public/.well-known/ucp-agent.json";

export const AGENT_PROFILE_PATH = "/.well-known/ucp-agent.json";
export const MERCHANT_PROFILE_PATH = "/.well-known/ucp";

export const AGENT_VERSION: string = agentProfile.ucp.version;
export const AGENT_CAPABILITIES: string[] = Object.keys(agentProfile.ucp.capabilities).sort();
export const AGENT_PAYMENT_HANDLERS: string[] = Object.keys(agentProfile.ucp.payment_handlers).sort();

export const CATALOG_SEARCH = "dev.ucp.shopping.catalog.search";

const DISCOVERY_TIMEOUT_MS = 6000;
const CATALOG_TIMEOUT_MS = 9000;
const MAX_BYTES = 768 * 1024;
const PRODUCTS_KEPT = 6;
const VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export interface UcpTransport {
  transport: string;
  version: string | null;
  endpoint: string | null;
}

export interface UcpCapabilityRef {
  name: string;
  version: string | null;
  spec: string | null;
}

export interface MerchantProfile {
  domain: string;
  requestedUrl: string;
  resolvedUrl: string;
  version: string | null;
  supportedVersions: string[];
  versionProfiles: Record<string, string>;
  transports: UcpTransport[];
  mcpEndpoint: string | null;
  capabilities: UcpCapabilityRef[];
  paymentHandlers: string[];
  cacheControl: string | null;
  bytes: number;
}

export type DiscoveryReason =
  | "invalid_domain"
  | "blocked_host"
  | "unreachable"
  | "http_error"
  | "too_large"
  | "not_json"
  | "not_ucp";

export type Discovery =
  | { ok: true; profile: MerchantProfile; ms: number }
  | { ok: false; domain: string; reason: DiscoveryReason; detail: string; status: number | null; ms: number };

export interface RejectedVersion {
  version: string;
  why: string;
}

export interface Negotiation {
  agentVersion: string;
  merchantVersion: string | null;
  offered: string[];
  chosen: string | null;
  pinned: string | null;
  rejected: RejectedVersion[];
  profileUrl: string;
  profileSource: "current" | "version_specific";
  confirmedVersion: string | null;
  detail: string;
}

export type CapabilityVerdict = "called" | "declined" | "absent";

export interface CapabilityDecision {
  name: string;
  version: string | null;
  verdict: CapabilityVerdict;
  why: string;
}

export interface PaymentDecision {
  offered: string[];
  declared: string[];
  matched: string[];
  why: string;
}

export interface CatalogItem {
  id: string;
  title: string;
  url: string | null;
  image: string | null;
  amountMinor: number | null;
  currency: string | null;
  price: string | null;
}

export type CatalogReason =
  | "no_endpoint"
  | "unreachable"
  | "http_error"
  | "not_json"
  | "protocol_error"
  | "no_products"
  | "capability_absent"
  | "version_unsupported"
  | "version_not_declared"
  | "version_profile_error";

export type CatalogOutcome =
  | {
      ok: true;
      query: string;
      endpoint: string;
      version: string | null;
      confirmedVersion: string | null;
      products: CatalogItem[];
      ms: number;
    }
  | {
      ok: false;
      query: string;
      endpoint: string | null;
      version: string | null;
      reason: CatalogReason;
      code: string | null;
      detail: string;
      ms: number;
    };

export interface Handshake {
  domain: string;
  profileUrl: string;
  agentVersion: string;
  spokeUcp: boolean;
  discovery: Discovery;
  negotiation: Negotiation | null;
  capabilities: CapabilityDecision[];
  payment: PaymentDecision | null;
  catalog: CatalogOutcome | null;
  ms: number;
}

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?)/i;

export function normalizeDomain(input: string): string | null {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw || raw.length > 253) return null;

  const withScheme = raw.includes("://") ? raw : `https://${raw}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }

  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null;
  return host;
}

export function normalizeVersion(input: string): string | null {
  const raw = (input ?? "").trim();
  return VERSION_SHAPE.test(raw) ? raw : null;
}

function isPublicHost(host: string): boolean {
  if (PRIVATE_HOST.test(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  return !/^\d+\.\d+\.\d+\.\d+$/.test(host);
}

function isPublicEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return isPublicHost(url.hostname.toLowerCase());
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readCapped(res: Response): Promise<{ text: string; bytes: number; capped: boolean }> {
  const body = res.body;
  if (!body) {
    const text = await res.text();
    return { text, bytes: text.length, capped: false };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let capped = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      capped = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: new TextDecoder().decode(merged), bytes, capped };
}

function readTransports(services: unknown): UcpTransport[] {
  const shopping = record(services)?.["dev.ucp.shopping"];
  if (!Array.isArray(shopping)) return [];

  return shopping.flatMap((entry) => {
    const item = record(entry);
    const transport = item ? str(item.transport) : null;
    if (!transport) return [];
    return [{ transport, version: str(item?.version), endpoint: str(item?.endpoint) }];
  });
}

function readCapabilities(capabilities: unknown): UcpCapabilityRef[] {
  const map = record(capabilities);
  if (!map) return [];

  const out: UcpCapabilityRef[] = [];
  for (const [name, entries] of Object.entries(map)) {
    const first = Array.isArray(entries) ? record(entries[0]) : null;
    out.push({ name, version: str(first?.version), spec: str(first?.spec) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function readVersionProfiles(supported: unknown): Record<string, string> {
  const map = record(supported);
  if (!map) return {};

  const out: Record<string, string> = {};
  for (const [version, uri] of Object.entries(map)) {
    const target = str(uri);
    if (VERSION_SHAPE.test(version) && target && isPublicEndpoint(target)) out[version] = target;
  }
  return out;
}

async function readProfileDocument(
  domain: string,
  url: string,
  timeoutMs: number,
  started: number,
): Promise<Discovery> {
  let res: Response;

  try {
    res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "banditd-ucp-agent/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      domain,
      reason: "unreachable",
      detail: aborted ? `No answer within ${timeoutMs} ms.` : "The host refused the connection.",
      status: null,
      ms: Date.now() - started,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      domain,
      reason: "http_error",
      detail:
        res.status === 404
          ? "The store has no UCP profile at that path, so it does not speak the protocol."
          : `The store answered ${res.status}.`,
      status: res.status,
      ms: Date.now() - started,
    };
  }

  const { text, bytes, capped } = await readCapped(res);

  if (capped) {
    return {
      ok: false,
      domain,
      reason: "too_large",
      detail: "The profile is larger than this client reads.",
      status: res.status,
      ms: Date.now() - started,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      domain,
      reason: "not_json",
      detail: "That path answered, but not with JSON.",
      status: res.status,
      ms: Date.now() - started,
    };
  }

  const ucp = record(record(parsed)?.ucp);
  if (!ucp) {
    return {
      ok: false,
      domain,
      reason: "not_ucp",
      detail: "The document has no ucp block, so there is nothing to negotiate.",
      status: res.status,
      ms: Date.now() - started,
    };
  }

  const transports = readTransports(ucp.services);
  const versionProfiles = readVersionProfiles(ucp.supported_versions);
  const handlers = record(ucp.payment_handlers);

  return {
    ok: true,
    ms: Date.now() - started,
    profile: {
      domain,
      requestedUrl: url,
      resolvedUrl: res.url || url,
      version: str(ucp.version),
      supportedVersions: Object.keys(versionProfiles).sort().reverse(),
      versionProfiles,
      transports,
      mcpEndpoint: transports.find((t) => t.transport === "mcp")?.endpoint ?? null,
      capabilities: readCapabilities(ucp.capabilities),
      paymentHandlers: handlers ? Object.keys(handlers).sort() : [],
      cacheControl: res.headers.get("cache-control"),
      bytes,
    },
  };
}

export async function discoverMerchant(input: string, timeoutMs = DISCOVERY_TIMEOUT_MS): Promise<Discovery> {
  const started = Date.now();
  const domain = normalizeDomain(input);

  if (!domain) {
    return {
      ok: false,
      domain: (input ?? "").trim().slice(0, 120),
      reason: "invalid_domain",
      detail: "That does not read as a domain name.",
      status: null,
      ms: Date.now() - started,
    };
  }

  if (!isPublicHost(domain)) {
    return {
      ok: false,
      domain,
      reason: "blocked_host",
      detail: "Only public hostnames are queried.",
      status: null,
      ms: Date.now() - started,
    };
  }

  return readProfileDocument(domain, `https://${domain}${MERCHANT_PROFILE_PATH}`, timeoutMs, started);
}

function unwrapRpc(text: string, contentType: string): unknown {
  const payload = contentType.includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("")
    : text;

  return JSON.parse(payload);
}

function unwrapToolResult(result: unknown): Record<string, unknown> | null {
  const direct = record(result);
  if (!direct) return null;
  if (Array.isArray(direct.products)) return direct;

  const structured = record(direct.structuredContent);
  if (structured) return structured;

  const content = direct.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const text = str(record(part)?.text);
      if (!text) continue;
      try {
        const inner = record(JSON.parse(text));
        if (inner) return inner;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function formatMinor(amount: number, currency: string): string {
  const value = amount / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function readProduct(entry: unknown): CatalogItem | null {
  const item = record(entry);
  const title = str(item?.title);
  if (!item || !title) return null;

  const min = record(record(item.price_range)?.min);
  const amount = typeof min?.amount === "number" ? min.amount : null;
  const currency = str(min?.currency);
  const media = Array.isArray(item.media) ? record(item.media[0]) : null;

  return {
    id: str(item.id) ?? title,
    title,
    url: str(item.url),
    image: str(media?.url) ?? str(record(media?.image)?.url),
    amountMinor: amount,
    currency,
    price: amount !== null && currency ? formatMinor(amount, currency) : null,
  };
}

export interface SearchInput {
  endpoint: string;
  profileUrl: string;
  version: string;
  query: string;
  country?: string;
  timeoutMs?: number;
}

export async function searchCatalog(input: SearchInput): Promise<CatalogOutcome> {
  const started = Date.now();
  const { endpoint, profileUrl, query, version } = input;
  const timeoutMs = input.timeoutMs ?? CATALOG_TIMEOUT_MS;
  const fail = (reason: CatalogReason, detail: string, code: string | null = null): CatalogOutcome => ({
    ok: false,
    query,
    endpoint,
    version,
    reason,
    code,
    detail,
    ms: Date.now() - started,
  });

  if (!isPublicEndpoint(endpoint)) {
    return fail(
      "no_endpoint",
      "The MCP endpoint the profile advertised does not resolve to a public https host, so it was not called.",
    );
  }

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile: profileUrl, version } },
        catalog: {
          query,
          context: { address_country: input.country ?? "US" },
        },
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "banditd-ucp-agent/1.0",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return fail("unreachable", aborted ? `No answer within ${timeoutMs} ms.` : "The endpoint refused the call.");
  }

  const { text, capped } = await readCapped(res);
  if (capped) return fail("http_error", "The answer is larger than this client reads.");

  let parsed: unknown;
  try {
    parsed = unwrapRpc(text, res.headers.get("content-type") ?? "");
  } catch {
    return fail("not_json", `The endpoint answered ${res.status} without usable JSON.`);
  }

  const envelope = record(parsed);
  const rpcError = record(envelope?.error);

  if (rpcError) {
    const data = record(rpcError.data);
    return fail(
      "protocol_error",
      str(data?.content) ?? str(rpcError.message) ?? "The endpoint rejected the call.",
      str(data?.code) ?? str(rpcError.code) ?? null,
    );
  }

  if (!res.ok) return fail("http_error", `The endpoint answered ${res.status}.`);

  const result = unwrapToolResult(envelope?.result);
  const confirmedVersion = str(record(result?.ucp)?.version);
  const products = Array.isArray(result?.products) ? result.products : [];
  const items = products.map(readProduct).filter((p): p is CatalogItem => p !== null).slice(0, PRODUCTS_KEPT);

  if (!items.length) return fail("no_products", "The search ran and came back with nothing to price.");

  return {
    ok: true,
    query,
    endpoint,
    version,
    confirmedVersion,
    products: items,
    ms: Date.now() - started,
  };
}

const DECLINE_NOTES: Record<string, string> = {
  "dev.ucp.shopping.cart":
    "The store opens carts for agents. This one publishes no payment handler, so it never opens one.",
  "dev.ucp.shopping.checkout":
    "The store would run a checkout. This agent declares no checkout capability, so it stops at the price.",
  "dev.ucp.shopping.order":
    "The store would create and track orders. Nothing is ordered here, so it stayed untouched.",
  "dev.ucp.shopping.discount":
    "Discount codes apply to a cart. There is no cart on this side, so there is nothing to apply them to.",
  "dev.ucp.shopping.fulfillment":
    "Shipping options belong to a checkout this agent does not open.",
  "dev.ucp.shopping.catalog.lookup":
    "Declared on both sides. A price check needs search alone, so lookup was not called.",
};

function declineNote(name: string): string {
  const known = DECLINE_NOTES[name];
  if (known) return known;
  if (!name.startsWith("dev.ucp."))
    return "Vendor extension outside the dev.ucp namespace. This agent negotiates dev.ucp only.";
  return "Not declared in the published agent profile, so it was left alone.";
}

const VERDICT_ORDER: Record<CapabilityVerdict, number> = { called: 0, absent: 1, declined: 2 };

export function decideCapabilities(
  offered: UcpCapabilityRef[],
  called: string | null,
): CapabilityDecision[] {
  const decisions: CapabilityDecision[] = offered.map((cap) => {
    if (cap.name === called) {
      return {
        name: cap.name,
        version: cap.version,
        verdict: "called" as const,
        why: "The store advertises it and this agent declares it, so the search request went out.",
      };
    }
    return { name: cap.name, version: cap.version, verdict: "declined" as const, why: declineNote(cap.name) };
  });

  const names = new Set(offered.map((cap) => cap.name));
  for (const wanted of AGENT_CAPABILITIES) {
    if (names.has(wanted)) continue;
    decisions.push({
      name: wanted,
      version: null,
      verdict: "absent",
      why: "This agent declares it. The store does not advertise it at the negotiated version.",
    });
  }

  return decisions.sort(
    (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.name.localeCompare(b.name),
  );
}

export function decidePayment(offered: string[]): PaymentDecision {
  const matched = offered.filter((handler) => AGENT_PAYMENT_HANDLERS.includes(handler));

  if (!offered.length) {
    return {
      offered,
      declared: AGENT_PAYMENT_HANDLERS,
      matched,
      why: "The store advertises no payment handler, and neither does this agent.",
    };
  }

  if (!AGENT_PAYMENT_HANDLERS.length) {
    return {
      offered,
      declared: AGENT_PAYMENT_HANDLERS,
      matched,
      why: `The store offers ${offered.length} payment handler${
        offered.length === 1 ? "" : "s"
      }. The published agent profile declares payment_handlers as an empty object, so none of them can match and no cart or checkout was opened.`,
    };
  }

  return {
    offered,
    declared: AGENT_PAYMENT_HANDLERS,
    matched,
    why: matched.length
      ? `Both sides carry ${matched.join(", ")}.`
      : "No handler is common to both profiles.",
  };
}

function rejectionNote(version: string, chosen: string, pinned: string | null): string {
  if (version === AGENT_VERSION && pinned) return `Set aside because this run was pinned to ${chosen}.`;
  return version > AGENT_VERSION
    ? `Newer than ${AGENT_VERSION}, the version this agent declares.`
    : `Older than ${AGENT_VERSION}, the version this agent declares.`;
}

export interface HandshakeInput {
  domain: string;
  profileUrl: string;
  query?: string;
  country?: string;
  version?: string;
}

export async function greetMerchant(input: HandshakeInput): Promise<Handshake> {
  const started = Date.now();
  const query = (input.query ?? "").trim() || "best seller";
  const discovery = await discoverMerchant(input.domain);

  const base = {
    profileUrl: input.profileUrl,
    agentVersion: AGENT_VERSION,
  };

  if (!discovery.ok) {
    return {
      ...base,
      domain: discovery.domain,
      spokeUcp: false,
      discovery,
      negotiation: null,
      capabilities: [],
      payment: null,
      catalog: null,
      ms: Date.now() - started,
    };
  }

  const profile = discovery.profile;
  const pinned = normalizeVersion(input.version ?? "");
  const target = pinned ?? AGENT_VERSION;
  const offered = Array.from(
    new Set([profile.version, ...Object.keys(profile.versionProfiles)].filter((v): v is string => !!v)),
  ).sort().reverse();

  const settle = (
    negotiation: Negotiation,
    capabilities: CapabilityDecision[],
    payment: PaymentDecision | null,
    catalog: CatalogOutcome,
  ): Handshake => ({
    ...base,
    domain: profile.domain,
    spokeUcp: true,
    discovery,
    negotiation,
    capabilities,
    payment,
    catalog,
    ms: Date.now() - started,
  });

  if (!offered.includes(target)) {
    const negotiation: Negotiation = {
      agentVersion: AGENT_VERSION,
      merchantVersion: profile.version,
      offered,
      chosen: null,
      pinned,
      rejected: offered.map((version) => ({
        version,
        why: `The store maps no profile for ${target}, so this version was not usable for this run.`,
      })),
      profileUrl: profile.resolvedUrl,
      profileSource: "current",
      confirmedVersion: null,
      detail: `The store offers ${offered.join(" and ")}. ${
        pinned ? `This run was pinned to ${target}` : `This agent declares ${target}`
      }, which is not among them, so no request was sent.`,
    };

    return settle(negotiation, [], decidePayment(profile.paymentHandlers), {
      ok: false,
      query,
      endpoint: null,
      version: null,
      reason: "version_unsupported",
      code: null,
      detail: negotiation.detail,
      ms: 0,
    });
  }

  let negotiated = profile;
  let profileSource: Negotiation["profileSource"] = "current";

  if (target !== profile.version) {
    const versionUrl = profile.versionProfiles[target];
    const leaf = await readProfileDocument(profile.domain, versionUrl, DISCOVERY_TIMEOUT_MS, Date.now());

    if (!leaf.ok) {
      const negotiation: Negotiation = {
        agentVersion: AGENT_VERSION,
        merchantVersion: profile.version,
        offered,
        chosen: target,
        pinned,
        rejected: offered
          .filter((v) => v !== target)
          .map((version) => ({ version, why: rejectionNote(version, target, pinned) })),
        profileUrl: versionUrl,
        profileSource: "version_specific",
        confirmedVersion: null,
        detail: `The store maps ${target} to its own profile, and that profile could not be read: ${leaf.detail}`,
      };

      return settle(negotiation, [], decidePayment(profile.paymentHandlers), {
        ok: false,
        query,
        endpoint: null,
        version: target,
        reason: "version_profile_error",
        code: null,
        detail: negotiation.detail,
        ms: 0,
      });
    }

    negotiated = leaf.profile;
    profileSource = "version_specific";
  }

  const negotiation: Negotiation = {
    agentVersion: AGENT_VERSION,
    merchantVersion: profile.version,
    offered,
    chosen: target,
    pinned,
    rejected: offered
      .filter((v) => v !== target)
      .map((version) => ({ version, why: rejectionNote(version, target, pinned) })),
    profileUrl: negotiated.resolvedUrl,
    profileSource,
    confirmedVersion: null,
    detail:
      profileSource === "current"
        ? `Both sides declare ${target}, so the profile at ${MERCHANT_PROFILE_PATH} describes the capabilities in play.`
        : `The store's current version is ${profile.version}. ${target} is mapped to its own profile, and that document is what the capabilities below were read from.`,
  };

  const payment = decidePayment(negotiated.paymentHandlers);
  const advertisesSearch = negotiated.capabilities.some((cap) => cap.name === CATALOG_SEARCH);

  if (!advertisesSearch) {
    return settle(negotiation, decideCapabilities(negotiated.capabilities, null), payment, {
      ok: false,
      query,
      endpoint: negotiated.mcpEndpoint,
      version: target,
      reason: "capability_absent",
      code: null,
      detail: `At ${target} the store advertises ${negotiated.capabilities.length} capabilit${
        negotiated.capabilities.length === 1 ? "y" : "ies"
      } and ${CATALOG_SEARCH} is not one of them, so the search was never called.`,
      ms: 0,
    });
  }

  if (pinned && pinned !== AGENT_VERSION) {
    return settle(negotiation, decideCapabilities(negotiated.capabilities, null), payment, {
      ok: false,
      query,
      endpoint: negotiated.mcpEndpoint,
      version: target,
      reason: "version_not_declared",
      code: null,
      detail: `The store does offer ${CATALOG_SEARCH} at ${pinned}, and this agent publishes ${AGENT_VERSION}. Sending a request under a version it does not declare would misstate who is calling, so the profile was read and nothing was sent.`,
      ms: 0,
    });
  }

  if (!negotiated.mcpEndpoint) {
    return settle(negotiation, decideCapabilities(negotiated.capabilities, null), payment, {
      ok: false,
      query,
      endpoint: null,
      version: target,
      reason: "no_endpoint",
      code: null,
      detail: `The store advertises ${CATALOG_SEARCH} at ${target} but publishes no MCP endpoint to call it on.`,
      ms: 0,
    });
  }

  const catalog = await searchCatalog({
    endpoint: negotiated.mcpEndpoint,
    profileUrl: input.profileUrl,
    version: target,
    query,
    country: input.country,
  });

  if (catalog.ok) negotiation.confirmedVersion = catalog.confirmedVersion;

  return settle(negotiation, decideCapabilities(negotiated.capabilities, CATALOG_SEARCH), payment, catalog);
}
