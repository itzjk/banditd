import { HttpFailure } from "./http.ts";

/**
 * The little storage the server needs: versioned documents (runs) and expiring
 * counters (rate limits). Two backends: Upstash / Vercel KV over REST for any
 * deployment with more than one instance, and process memory for development,
 * tests or a deliberate single-instance deployment (RUN_STORE=memory).
 */
export interface Kv {
  read(key: string): Promise<{ value: string; version: number } | null>;
  /** Writes `value` only if the stored version is still `expected` (0 = absent). */
  swap(key: string, expected: number, value: string, ttlSeconds: number): Promise<boolean>;
  /** Adds one to a counter that expires `ttlSeconds` after its first hit. */
  hit(key: string, ttlSeconds: number): Promise<number>;
}

interface Slot {
  value: string;
  version: number;
  expires: number;
}

export class MemoryKv implements Kv {
  private docs = new Map<string, Slot>();
  private counters = new Map<string, { n: number; expires: number }>();

  private live<T extends { expires: number }>(map: Map<string, T>, key: string): T | null {
    const slot = map.get(key);
    if (!slot) return null;
    if (slot.expires <= Date.now()) {
      map.delete(key);
      return null;
    }
    return slot;
  }

  async read(key: string) {
    const slot = this.live(this.docs, key);
    return slot ? { value: slot.value, version: slot.version } : null;
  }

  async swap(key: string, expected: number, value: string, ttlSeconds: number) {
    const current = this.live(this.docs, key)?.version ?? 0;
    if (current !== expected) return false;
    this.docs.set(key, { value, version: expected + 1, expires: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async hit(key: string, ttlSeconds: number) {
    const slot = this.live(this.counters, key);
    if (slot) {
      slot.n += 1;
      return slot.n;
    }
    this.counters.set(key, { n: 1, expires: Date.now() + ttlSeconds * 1000 });
    return 1;
  }
}

const SWAP_SCRIPT = `
local v = tonumber(redis.call('GET', KEYS[2]) or '0')
if v ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('SET', KEYS[2], tostring(v + 1), 'EX', ARGV[3])
return 1`;

const HIT_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

const KV_TIMEOUT_MS = 5000;

function unavailable(detail: string): HttpFailure {
  return new HttpFailure(
    "STORE_UNAVAILABLE",
    503,
    `The run store did not answer (${detail}). Nothing was changed or spent. Try again in a moment.`,
    { retryAfterSeconds: 5 },
  );
}

export class UpstashKv implements Kv {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  private async command(args: string[]): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: AbortSignal.timeout(KV_TIMEOUT_MS),
      });
    } catch (e) {
      throw unavailable(e instanceof Error ? e.name : "network error");
    }
    const data = (await res.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
    if (!res.ok || !data || data.error !== undefined) {
      throw unavailable(`HTTP ${res.status}${data?.error ? `, ${String(data.error)}` : ""}`);
    }
    return data.result;
  }

  async read(key: string) {
    const result = await this.command(["MGET", key, `${key}:v`]);
    if (!Array.isArray(result) || typeof result[0] !== "string") return null;
    const version = Number(result[1]);
    if (!Number.isInteger(version) || version < 1) throw unavailable(`no version stored for ${key}`);
    return { value: result[0], version };
  }

  async swap(key: string, expected: number, value: string, ttlSeconds: number) {
    const result = await this.command([
      "EVAL",
      SWAP_SCRIPT,
      "2",
      key,
      `${key}:v`,
      String(expected),
      value,
      String(ttlSeconds),
    ]);
    return Number(result) === 1;
  }

  async hit(key: string, ttlSeconds: number) {
    const result = await this.command(["EVAL", HIT_SCRIPT, "1", key, String(ttlSeconds)]);
    const n = Number(result);
    if (!Number.isInteger(n)) throw unavailable("the counter came back unreadable");
    return n;
  }
}

const holder = globalThis as typeof globalThis & { __banditdMemoryKv?: MemoryKv };

function memory(): MemoryKv {
  // Kept on globalThis so a dev server hot reload does not drop every run.
  holder.__banditdMemoryKv ??= new MemoryKv();
  return holder.__banditdMemoryKv;
}

export function kv(): Kv {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashKv(url, token);
  if (process.env.RUN_STORE === "memory" || process.env.NODE_ENV !== "production") return memory();
  throw new HttpFailure(
    "STORE_NOT_CONFIGURED",
    503,
    "This deployment has no run store, so it cannot keep runs, credits or rate limits on the server and refuses to start one. Set KV_REST_API_URL and KV_REST_API_TOKEN (Vercel KV or Upstash), or RUN_STORE=memory for a single-instance server.",
  );
}
