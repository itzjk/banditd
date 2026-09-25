// The server-owned run: sessions, contracts, atomic credits, evidence from the
// server's own counts, limits, and the fail-closed paths.
import { APP, clearNetwork, freshIp, post, reached, read, withEnv, onNetwork } from "./helpers.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as productRoute from "../app/api/product/route.ts";
import * as researchRoute from "../app/api/research/route.ts";
import * as imageRoute from "../app/api/image/route.ts";
import * as simulateRoute from "../app/api/simulate/route.ts";
import * as purchaseRoute from "../app/api/purchase/route.ts";
import * as chatRoute from "../app/api/chat/route.ts";
import { updateRun } from "../lib/run-store.ts";
import type { Creative, State } from "../lib/store.ts";

beforeEach(() => clearNetwork());

interface Browser {
  ip: string;
  cookie: string;
  sid: string;
  state: State;
}

async function startRun(ip = freshIp()): Promise<Browser> {
  const res = await productRoute.POST(
    post("/api/product", { name: "Cold brew", price: "28", description: "Concentrate, 1 litre" }, { ip }),
  );
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(";")[0];
  const state = (await res.json()) as State;
  return { ip, cookie, sid: cookie.split("=")[1], state };
}

function creative(id: string): Creative {
  return {
    id,
    generation: 0,
    parentId: null,
    angle: "price",
    headline: `Headline ${id}`,
    body: "body",
    imagePrompt: `stored prompt for ${id}`,
    targetEmotion: "calm",
    imageData: null,
    arm: { impressions: 0, clicks: 0 },
  };
}

/** Puts four creatives on a run the way /api/creatives would, without a model. */
async function seedCreatives(browser: Browser, credits?: number) {
  await updateRun(browser.state.runId, { ip: browser.ip, sid: browser.sid }, ({ state }) => {
    state.creatives.push(creative("cr_t_0"), creative("cr_t_1"), creative("cr_t_2"), creative("cr_t_3"));
    if (credits !== undefined) state.credits.balance = credits;
  });
}

test("a run is created on the server, owned by an HttpOnly session", async () => {
  const browser = await startRun();
  assert.match(browser.state.runId, /^run_[0-9a-f]{32}$/);
  assert.equal(browser.state.credits.balance, 4);
  assert.equal(browser.state.version, 1);
});

test("another session cannot read or change a run it does not own", async () => {
  const a = await startRun();
  const b = await startRun();
  const res = await simulateRoute.POST(
    post("/api/simulate", { runId: a.state.runId, impressions: 500 }, { cookie: b.cookie, ip: b.ip }),
  );
  const { status, data } = await read(res);
  assert.equal(status, 403);
  assert.equal(data.code, "RUN_NOT_YOURS");
});

test("a whole state in the body is refused by name", async () => {
  const a = await startRun();
  const res = await researchRoute.POST(
    post("/api/research", { runId: a.state.runId, state: a.state }, { cookie: a.cookie, ip: a.ip }),
  );
  const { status, data } = await read(res);
  assert.equal(status, 400);
  assert.equal(data.code, "BAD_REQUEST");
  assert.match(String(data.error), /state/);
  assert.deepEqual(reached("openai.com"), []);
});

test("parallel renders cannot spend the same last credit, and a failed render refunds it", async () => {
  const a = await startRun();
  await seedCreatives(a, 1);
  const results = await Promise.all(
    ["cr_t_0", "cr_t_1", "cr_t_2", "cr_t_3"].map((creativeId) =>
      imageRoute.POST(post("/api/image", { runId: a.state.runId, creativeId }, { cookie: a.cookie, ip: a.ip })).then(read),
    ),
  );
  const refused = results.filter((r) => r.data.code === "NO_CREDITS");
  const rendered = results.filter((r) => r.data.code !== "NO_CREDITS");
  assert.equal(refused.length, 3, JSON.stringify(results.map((r) => r.data.code)));
  assert.equal(rendered.length, 1);
  assert.equal(reached("openai.com").length, 1, "exactly one render reached the model");
  // The stub answers 401: the route reports that cause, not "came back empty".
  assert.equal(rendered[0].data.code, "BAD_CREDENTIALS");
  const after = rendered[0].data.state as State;
  assert.equal(after.credits.balance, 1, "the failed render gave its credit back");
  assert.match(reached("openai.com")[0].body, /stored prompt for cr_t_/, "the prompt came from the stored creative");
});

test("simulate is the only writer of counts, and impressions are bounded", async () => {
  const a = await startRun();
  await seedCreatives(a);
  const tooMany = await read(
    await simulateRoute.POST(
      post("/api/simulate", { runId: a.state.runId, impressions: 1e9 }, { cookie: a.cookie, ip: a.ip }),
    ),
  );
  assert.equal(tooMany.status, 400);

  const served = await read(
    await simulateRoute.POST(
      post("/api/simulate", { runId: a.state.runId, impressions: 800 }, { cookie: a.cookie, ip: a.ip }),
    ),
  );
  assert.equal(served.status, 200);
  const state = served.data as unknown as State;
  assert.equal(state.creatives.reduce((sum, c) => sum + c.arm.impressions, 0), 800);
  assert.equal(state.simulatedImpressions, 800);
});

test("purchase reads the stored cohort: no traffic, no charge, no Prava call", async () => {
  const a = await startRun();
  await seedCreatives(a);
  const { status, data } = await read(
    await purchaseRoute.POST(post("/api/purchase", { runId: a.state.runId }, { cookie: a.cookie, ip: a.ip })),
  );
  assert.equal(status, 409);
  assert.equal(data.code, "EVIDENCE_INSUFFICIENT");
  assert.deepEqual(reached("prava.test"), []);
});

test("in production the forced demo charges need DEMO_FORCE and the admin token", async () => {
  await withEnv({ NODE_ENV: "production", APP_URL: APP, RUN_STORE: "memory" }, async () => {
    const res = await productRoute.POST(
      post("/api/product", { name: "P", price: "5", description: "d" }, { ip: freshIp(), origin: APP }),
    );
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(res.headers.get("set-cookie") ?? "", /Secure/);
    const { runId } = (await res.json()) as State;

    const refused = await read(
      await purchaseRoute.POST(post("/api/purchase", { runId, force: true }, { cookie, origin: APP })),
    );
    assert.equal(refused.status, 403);
    assert.equal(refused.data.code, "FORCE_DISABLED");

    const token = "a-long-operator-token-1234";
    await withEnv({ DEMO_FORCE: "1", ADMIN_TOKEN: token }, async () => {
      const wrong = await read(
        await purchaseRoute.POST(
          post("/api/purchase", { runId, force: true }, { cookie, origin: APP, headers: { "x-banditd-admin": "x".repeat(token.length) } }),
        ),
      );
      assert.equal(wrong.data.code, "FORCE_DISABLED");
      const right = await read(
        await purchaseRoute.POST(
          post("/api/purchase", { runId, force: true }, { cookie, origin: APP, headers: { "x-banditd-admin": token } }),
        ),
      );
      // Past the gate, the run has no creatives, so it stops on the evidence.
      assert.equal(right.data.code, "NO_EVIDENCE");
    });
    assert.deepEqual(reached("prava.test"), []);
  });
});

test("production without a run store refuses to start a run", async () => {
  await withEnv(
    { NODE_ENV: "production", APP_URL: APP, RUN_STORE: undefined, KV_REST_API_URL: undefined, UPSTASH_REDIS_REST_URL: undefined },
    async () => {
      const { status, data } = await read(
        await productRoute.POST(
          post("/api/product", { name: "P", price: "5", description: "d" }, { ip: freshIp(), origin: APP }),
        ),
      );
      assert.equal(status, 503);
      assert.equal(data.code, "STORE_NOT_CONFIGURED");
    },
  );
});

test("each network address gets a bounded number of new runs per hour", async () => {
  const ip = freshIp();
  const codes: number[] = [];
  for (let i = 0; i < 13; i++) {
    const res = await productRoute.POST(post("/api/product", { name: "P", price: "5", description: "d" }, { ip }));
    codes.push(res.status);
  }
  assert.deepEqual(codes.slice(0, 12), Array(12).fill(200));
  assert.equal(codes[12], 429);
});

test("the daily ceiling on paid calls holds and says so", async () => {
  const a = await startRun();
  await withEnv({ DAILY_MODEL_CALLS: "0" }, async () => {
    const { status, data } = await read(
      await researchRoute.POST(post("/api/research", { runId: a.state.runId }, { cookie: a.cookie, ip: a.ip })),
    );
    assert.equal(status, 429);
    assert.equal(data.code, "DAILY_LIMIT_REACHED");
  });
  assert.deepEqual(reached("openai.com"), []);
});

test("the chat only resumes a response id this run was handed", async () => {
  const a = await startRun();
  const { status, data } = await read(
    await chatRoute.POST(
      post(
        "/api/chat",
        { runId: a.state.runId, responseId: "resp_someone_elses_123", outputs: [{ callId: "call_abcd", output: "{}" }] },
        { cookie: a.cookie, ip: a.ip },
      ),
    ),
  );
  assert.equal(status, 409);
  assert.equal(data.code, "UNKNOWN_RESPONSE");
  assert.deepEqual(reached("openai.com"), []);
});

test("listing edits go through the server and keep the evidence", async () => {
  const a = await startRun();
  const res = await productRoute.PATCH(
    post("/api/product", { runId: a.state.runId, price: "30", variant: "oat" }, { cookie: a.cookie, ip: a.ip, method: "PATCH" }),
  );
  const { status, data } = await read(res);
  assert.equal(status, 200);
  const state = data as unknown as State;
  assert.equal(state.product?.price, "$30.00");
  assert.equal(state.product?.variant, "oat");
  assert.equal(state.version, 2);
});

test("a purchase that Prava never answers is recorded as unknown, not as a decline", async () => {
  const a = await startRun();
  await seedCreatives(a);
  // Traffic where one arm clearly wins, written the only way counts are written.
  await updateRun(a.state.runId, { ip: a.ip, sid: a.sid }, ({ state }) => {
    const rates = [0.01, 0.01, 0.01, 0.08];
    state.creatives.forEach((c, i) => {
      c.arm = { impressions: 20000, clicks: Math.round(20000 * rates[i]) };
    });
  });
  onNetwork((url, init) => {
    if (url.endsWith("/v1/mandates?customer_id=seller_test")) {
      return Response.json([
        { id: "mdt_01KZ0KP8EEDFRP425E74Y6HSJ0", status: "active", approvedAmount: "50.00", remaining: "50.00", merchantName: "Banditd Render Credits" },
      ]);
    }
    if (url.includes("/charge")) {
      // Behave like a request that never comes back before its timeout.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
      });
    }
    return new Response("{}", { status: 404 });
  });
  await withEnv({ PRAVA_CHARGE_TIMEOUT_MS: "50" }, async () => {
    const { data } = await read(
      await purchaseRoute.POST(post("/api/purchase", { runId: a.state.runId }, { cookie: a.cookie, ip: a.ip })),
    );
    const last = data.lastPurchase as { ok: boolean; errorCode: string } | undefined;
    assert.equal(last?.ok, false, JSON.stringify(data).slice(0, 300));
    assert.equal(last?.errorCode, "CHARGE_OUTCOME_UNKNOWN");
    assert.equal(reached("/charge").length, 1, "an unknown outcome is never retried on another mandate");
  });
});
