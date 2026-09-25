import { randomBytes, timingSafeEqual } from "node:crypto";
import { HttpFailure } from "./http.ts";
import { kv } from "./kv.ts";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "./same-origin.ts";

/**
 * Who may reach the paths that cost money, and how often.
 *
 * - A session is an opaque random id in an HttpOnly cookie, issued by the
 *   server when a run is created. Every run is owned by the session that made
 *   it, so a run id alone does not open someone else's run.
 * - Every costly action is counted per client IP and per session in fixed
 *   windows, and the paid ones also against a deployment-wide daily ceiling.
 *   The ceiling is what bounds the bill when a caller rotates IPs and sessions.
 */

export type Action = "run" | "edit" | "model" | "image" | "purchase" | "simulate" | "read" | "outbound";

interface Window {
  limit: number;
  seconds: number;
}

interface Policy {
  perIp: Window;
  perSession?: Window;
  /** Deployment-wide calls per UTC day, overridable by the named variable. */
  daily?: { limit: number; env: string };
}

const HOUR = 3600;

const POLICY: Record<Action, Policy> = {
  run: { perIp: { limit: 12, seconds: HOUR }, daily: { limit: 300, env: "DAILY_RUN_LIMIT" } },
  edit: { perIp: { limit: 240, seconds: HOUR }, perSession: { limit: 120, seconds: HOUR } },
  model: {
    perIp: { limit: 90, seconds: HOUR },
    perSession: { limit: 60, seconds: HOUR },
    daily: { limit: 1500, env: "DAILY_MODEL_CALLS" },
  },
  image: {
    perIp: { limit: 40, seconds: HOUR },
    perSession: { limit: 30, seconds: HOUR },
    daily: { limit: 400, env: "DAILY_IMAGE_RENDERS" },
  },
  purchase: {
    perIp: { limit: 10, seconds: HOUR },
    perSession: { limit: 6, seconds: HOUR },
    daily: { limit: 60, env: "DAILY_PURCHASES" },
  },
  simulate: { perIp: { limit: 900, seconds: HOUR }, perSession: { limit: 600, seconds: HOUR } },
  read: { perIp: { limit: 600, seconds: HOUR } },
  outbound: { perIp: { limit: 30, seconds: HOUR }, daily: { limit: 600, env: "DAILY_OUTBOUND_CALLS" } },
};

export const SESSION_COOKIE = "banditd_sid";
const SESSION_SHAPE = /^[0-9a-f]{32}$/;
const SESSION_MAX_AGE = 30 * 24 * HOUR;

export interface Client {
  ip: string;
  sid: string | null;
}

export function sessionOf(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    const value = rest.join("=");
    return SESSION_SHAPE.test(value) ? value : null;
  }
  return null;
}

export function newSession(): string {
  return randomBytes(16).toString("hex");
}

export function sessionCookie(sid: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

/**
 * The caller's IP as the platform reports it. Only Vercel (or a proxy the
 * operator vouches for with TRUST_PROXY_HEADERS=1) overwrites these headers;
 * anywhere else they are the caller's own words, so every caller shares one
 * bucket instead of choosing its own.
 */
export function clientIp(req: Request): string {
  const trusted = Boolean(process.env.VERCEL) || process.env.TRUST_PROXY_HEADERS === "1";
  if (!trusted) return "unattributed";
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unattributed";
}

function dailyLimit(policy: Policy): number | null {
  if (!policy.daily) return null;
  const raw = process.env[policy.daily.env];
  if (raw === undefined || raw === "") return policy.daily.limit;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpFailure(
      "LIMIT_MISCONFIGURED",
      503,
      `${policy.daily.env} is set to "${raw}", which is not a whole number of calls, so the daily ceiling cannot be enforced and the call was refused.`,
    );
  }
  return n;
}

async function spend(key: string, window: Window, who: string): Promise<void> {
  const bucket = Math.floor(Date.now() / 1000 / window.seconds);
  const count = await kv().hit(`rl:${key}:${bucket}`, window.seconds);
  if (count > window.limit) {
    const retry = window.seconds - (Math.floor(Date.now() / 1000) % window.seconds);
    throw new HttpFailure(
      "RATE_LIMITED",
      429,
      `${who} has used its ${window.limit} calls of this kind for the current ${Math.round(window.seconds / 60)} minute window. Nothing was spent. Try again in ${Math.ceil(retry / 60)} minutes.`,
      { retryAfterSeconds: retry },
    );
  }
}

/**
 * The gate every costly route passes before doing anything: the request has to
 * come from this site, and the caller has to be inside its limits.
 */
export async function guard(req: Request, action: Action): Promise<Client> {
  if (!fromOurPage(req)) throw new HttpFailure(OFF_PAGE_CODE, 403, OFF_PAGE_MESSAGE);
  return limit(req, action);
}

/** Counts the call against the caller's limits without the same-site check. */
export async function limit(req: Request, action: Action): Promise<Client> {
  const client: Client = { ip: clientIp(req), sid: sessionOf(req) };
  const policy = POLICY[action];

  await spend(`${action}:ip:${client.ip}`, policy.perIp, "This network address");
  if (policy.perSession && client.sid) {
    await spend(`${action}:sid:${client.sid}`, policy.perSession, "This browser session");
  }
  const daily = dailyLimit(policy);
  if (daily !== null) {
    const day = new Date().toISOString().slice(0, 10);
    const count = await kv().hit(`rl:${action}:day:${day}`, 26 * HOUR);
    if (count > daily) {
      throw new HttpFailure(
        "DAILY_LIMIT_REACHED",
        429,
        `This deployment has reached its ceiling of ${daily} ${action} calls for today (UTC). Nothing was spent. It opens again at midnight UTC.`,
        { retryAfterSeconds: 86400 - (Math.floor(Date.now() / 1000) % 86400) },
      );
    }
  }
  return client;
}

export function requireSession(client: Client): string {
  if (!client.sid) {
    throw new HttpFailure(
      "NO_SESSION",
      401,
      "This browser has no banditd session, so it owns no run. Start a run from the home page first.",
    );
  }
  return client.sid;
}

/**
 * The guardrail demos (a deliberate over-cap charge, a charge outside the
 * merchant scope) spend against real mandates. Outside production they are
 * open for development; in production they need DEMO_FORCE=1 and the operator's
 * ADMIN_TOKEN in the x-banditd-admin header.
 */
export function forceAllowed(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.DEMO_FORCE !== "1") return false;
  const expected = process.env.ADMIN_TOKEN ?? "";
  const given = req.headers.get("x-banditd-admin") ?? "";
  if (expected.length < 16 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
