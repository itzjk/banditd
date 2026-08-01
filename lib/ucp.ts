export const UCP_VERSION = "2026-04-08";
export const AGENT_PROFILE_PATH = "/.well-known/ucp-agent.json";
export const MERCHANT_PROFILE_PATH = "/.well-known/ucp";

const DISCOVERY_TIMEOUT_MS = 6000;
const CATALOG_TIMEOUT_MS = 9000;
const MAX_BYTES = 768 * 1024;
const PRODUCTS_KEPT = 6;

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
  | "no_products";

export type CatalogOutcome =
  | { ok: true; query: string; endpoint: string; products: CatalogItem[]; ms: number }
  | {
      ok: false;
      query: string;
      endpoint: string | null;
      reason: CatalogReason;
      code: string | null;
      detail: string;
      ms: number;
    };

export interface Handshake {
  domain: string;
  profileUrl: string;
  spokeUcp: boolean;
  discovery: Discovery;
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

function isPublicHost(host: string): boolean {
  if (PRIVATE_HOST.test(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  return !/^\d+\.\d+\.\d+\.\d+$/.test(host);
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

  const requestedUrl = `https://${domain}${MERCHANT_PROFILE_PATH}`;
  let res: Response;

  try {
    res = await fetch(requestedUrl, {
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
  const supported = record(ucp.supported_versions);
  const handlers = record(ucp.payment_handlers);

  return {
    ok: true,
    ms: Date.now() - started,
    profile: {
      domain,
      requestedUrl,
      resolvedUrl: res.url || requestedUrl,
      version: str(ucp.version),
      supportedVersions: supported ? Object.keys(supported).sort().reverse() : [],
      transports,
      mcpEndpoint: transports.find((t) => t.transport === "mcp")?.endpoint ?? null,
      capabilities: readCapabilities(ucp.capabilities),
      paymentHandlers: handlers ? Object.keys(handlers).sort() : [],
      cacheControl: res.headers.get("cache-control"),
      bytes,
    },
  };
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
  query: string;
  country?: string;
  timeoutMs?: number;
}

export async function searchCatalog(input: SearchInput): Promise<CatalogOutcome> {
  const started = Date.now();
  const { endpoint, profileUrl, query } = input;
  const timeoutMs = input.timeoutMs ?? CATALOG_TIMEOUT_MS;
  const fail = (reason: CatalogReason, detail: string, code: string | null = null): CatalogOutcome => ({
    ok: false,
    query,
    endpoint,
    reason,
    code,
    detail,
    ms: Date.now() - started,
  });

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "search_catalog",
      arguments: {
        meta: { "ucp-agent": { profile: profileUrl } },
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
  const products = Array.isArray(result?.products) ? result.products : [];
  const items = products.map(readProduct).filter((p): p is CatalogItem => p !== null).slice(0, PRODUCTS_KEPT);

  if (!items.length) return fail("no_products", "The search ran and came back with nothing to price.");

  return { ok: true, query, endpoint, products: items, ms: Date.now() - started };
}

export interface HandshakeInput {
  domain: string;
  profileUrl: string;
  query?: string;
  country?: string;
}

export async function greetMerchant(input: HandshakeInput): Promise<Handshake> {
  const started = Date.now();
  const query = (input.query ?? "").trim() || "best seller";
  const discovery = await discoverMerchant(input.domain);

  if (!discovery.ok) {
    return {
      domain: discovery.domain,
      profileUrl: input.profileUrl,
      spokeUcp: false,
      discovery,
      catalog: null,
      ms: Date.now() - started,
    };
  }

  const endpoint = discovery.profile.mcpEndpoint;

  const catalog: CatalogOutcome = endpoint
    ? await searchCatalog({ endpoint, profileUrl: input.profileUrl, query, country: input.country })
    : {
        ok: false,
        query,
        endpoint: null,
        reason: "no_endpoint",
        code: null,
        detail: "The store speaks UCP but publishes no MCP endpoint to call.",
        ms: 0,
      };

  return {
    domain: discovery.profile.domain,
    profileUrl: input.profileUrl,
    spokeUcp: true,
    discovery,
    catalog,
    ms: Date.now() - started,
  };
}
