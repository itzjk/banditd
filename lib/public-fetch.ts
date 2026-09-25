import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * fetch for addresses a stranger typed in. The hostname is resolved first and
 * every address it resolves to has to be public, redirects are followed by
 * hand so each hop is checked the same way, and nothing else is sent.
 *
 * What this does not close: the socket resolves the name again, so a DNS
 * server that answers public to the check and private to the connect
 * (rebinding) can still slip through. Closing that needs a pinned-address
 * dispatcher, which Node's built-in fetch does not expose without undici.
 */

export class BlockedDestination extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedDestination";
  }
}

export type Lookup = (host: string) => Promise<string[]>;

const defaultLookup: Lookup = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

const MAX_REDIRECTS = 3;

function v4Private(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return !v4Private(address);
  if (kind !== 6) return false;
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return !v4Private(mapped[1]);
  if (lower === "::" || lower === "::1") return false;
  if (/^f[cd]/.test(lower)) return false; // unique local fc00::/7
  if (/^fe[89ab]/.test(lower)) return false; // link local fe80::/10
  if (lower.startsWith("ff")) return false; // multicast
  if (lower.startsWith("64:ff9b:")) return false; // NAT64 into IPv4 space
  return true;
}

async function checkDestination(url: URL, lookup: Lookup): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BlockedDestination(`${url.protocol} is not a protocol this client calls`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new BlockedDestination(`${host} does not resolve`);
    }
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new BlockedDestination(`${host} resolves to an address that is not on the public internet`);
  }
}

export async function publicFetch(
  input: string,
  init: RequestInit = {},
  lookup: Lookup = defaultLookup,
): Promise<Response> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkDestination(url, lookup);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel().catch(() => undefined);
    url = new URL(location, url);
    if (init.method && init.method !== "GET" && res.status !== 307 && res.status !== 308) {
      throw new BlockedDestination("the endpoint answered a POST with a redirect, which this client does not follow");
    }
  }
  throw new BlockedDestination(`more than ${MAX_REDIRECTS} redirects`);
}
