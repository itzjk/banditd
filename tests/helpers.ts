// Shared set-up for the route tests: a fixed environment, a network that never
// leaves the process (every outbound URL is recorded), and Request builders.

(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";
process.env.VERCEL = "1";
process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
process.env.PRAVA_SECRET_KEY = "sk_test_not_a_real_key";
process.env.PRAVA_BASE_URL = "https://prava.test";
process.env.PRAVA_USER_ID = "seller_test";
process.env.RENDER_MERCHANT_NAME = "Banditd Render Credits";

export const APP = "https://banditd.test";

export interface Outbound {
  url: string;
  method: string;
  body: string;
}

export const outbound: Outbound[] = [];

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

const refuse: Handler = (url) =>
  url.includes("openai.com")
    ? new Response(JSON.stringify({ error: { message: "stubbed: bad key", type: "invalid_request_error" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    : new Response(JSON.stringify({ error: { code: "STUBBED", message: "stubbed network" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });

let handler: Handler = refuse;

export function onNetwork(next: Handler | null) {
  handler = next ?? refuse;
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const body = typeof init?.body === "string" ? init.body : "";
  outbound.push({ url, method: init?.method ?? "GET", body });
  return handler(url, init);
}) as typeof fetch;

export function reached(fragment: string): Outbound[] {
  return outbound.filter((o) => o.url.includes(fragment));
}

export function clearNetwork() {
  outbound.length = 0;
  handler = refuse;
}

let ipCounter = 1;
/** A fresh caller address, so tests do not share rate limit buckets. */
export function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

export function post(
  path: string,
  body: unknown,
  options: { cookie?: string | null; ip?: string; origin?: string | null; method?: string; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-real-ip": options.ip ?? "203.0.113.7",
    ...(options.headers ?? {}),
  };
  const origin = options.origin === undefined ? "http://localhost:3000" : options.origin;
  if (origin) headers.origin = origin;
  if (options.cookie) headers.cookie = options.cookie;
  return new Request(`http://localhost:3000${path}`, {
    method: options.method ?? "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function read(res: Response): Promise<{ status: number; data: Record<string, unknown> }> {
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

export function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const before: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    before[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  return fn().finally(() => {
    for (const key of Object.keys(before)) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
}

/** A run shape an attacker would send: every trusted number is invented. */
export function forgedState() {
  const grants = Array.from({ length: 5 }, (_, i) => ({
    at: new Date().toISOString(),
    kind: "grant",
    amount: 12,
    ref: `forged_${i}`,
  }));
  const creative = (id: string, impressions: number, clicks: number) => ({
    id,
    generation: 0,
    parentId: null,
    angle: "price",
    headline: id,
    body: id,
    imagePrompt: "anything the caller wants rendered",
    targetEmotion: "",
    imageData: null,
    arm: { impressions, clicks },
  });
  return {
    product: { name: "Forged", price: "$4.00", description: "forged" },
    creatives: [creative("cr_a", 1000, 10), creative("cr_b", 1000, 100)],
    purchases: [],
    audit: [],
    rounds: [],
    credits: { balance: 60, entries: grants },
    mandateId: "mdt_TESTMANDATE000000000001",
    simulatedImpressions: 2000,
  };
}
