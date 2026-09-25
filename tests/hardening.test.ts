// Second audit: upstream error text never reaches the browser with secrets in
// it, revoking a mandate is an operator action, and every page ships the
// anti-framing headers.
import { APP, clearNetwork, freshIp, onNetwork, post, reached, read, withEnv } from "./helpers.ts";
import { startRun, seedCreatives } from "./runs.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as imageRoute from "../app/api/image/route.ts";
import * as purchaseRoute from "../app/api/purchase/route.ts";
import * as revokeRoute from "../app/api/mandate/revoke/route.ts";
import * as productRoute from "../app/api/product/route.ts";
import { updateRun } from "../lib/run-store.ts";
import { safeError } from "../lib/redact.ts";
import nextConfig from "../next.config.ts";

beforeEach(() => clearNetwork());

// What OpenAI and Prava actually put in an error for the account owner.
const KEY_TAIL = "wXyZ";
const ORG = "org-AbCdEf123456";
const OPENAI_LEAK = `Incorrect API key provided: sk-proj-********************${KEY_TAIL}. Organization ${ORG}, project proj_Q1w2E3r4.`;
const PRAVA_LEAK = `Unauthorized key sk_test_51Hab${KEY_TAIL} for seller@banditd.dev`;

function assertClean(text: string) {
  assert.doesNotMatch(text, new RegExp(KEY_TAIL), "the key tail reached the client");
  assert.doesNotMatch(text, /org-AbCdEf/, "the organization id reached the client");
  assert.doesNotMatch(text, /proj_Q1w2/, "the project id reached the client");
  assert.doesNotMatch(text, /seller@banditd\.dev/, "the account email reached the client");
}

test("safeError removes key tails, organization and project ids, and emails", () => {
  const out = safeError(new Error(`${OPENAI_LEAK} ${PRAVA_LEAK} Bearer abcdefghijkl123`));
  assertClean(out);
  assert.doesNotMatch(out, /Bearer abcdef/);
  assert.match(out, /Incorrect API key provided/, "the useful part of the sentence survives");
});

test("an OpenAI rejection reaches the browser without the key tail or the org id", async () => {
  const a = await startRun();
  await seedCreatives(a);
  onNetwork((url) =>
    url.includes("openai.com")
      ? Response.json({ error: { message: OPENAI_LEAK, type: "invalid_request_error" } }, { status: 403 })
      : new Response("{}", { status: 404 }),
  );
  const res = await imageRoute.POST(
    post("/api/image", { runId: a.state.runId, creativeId: "cr_t_0" }, { cookie: a.cookie, ip: a.ip }),
  );
  const text = await res.text();
  assert.equal(res.status, 502);
  assert.match(text, /UPSTREAM_REJECTED/);
  assertClean(text);
});

test("a Prava error reaches the purchase answer and the audit log redacted", async () => {
  const a = await startRun();
  await seedCreatives(a);
  await updateRun(a.state.runId, { ip: a.ip, sid: a.sid }, ({ state }) => {
    const rates = [0.01, 0.01, 0.01, 0.08];
    state.creatives.forEach((c, i) => {
      c.arm = { impressions: 20000, clicks: Math.round(20000 * rates[i]) };
    });
  });
  onNetwork((url) => {
    if (url.includes("/v1/mandates?")) {
      return Response.json([
        { id: "mdt_TESTMANDATE000000000001", status: "active", approvedAmount: "50.00", remaining: "50.00", merchantName: "Banditd Render Credits" },
      ]);
    }
    if (url.includes("/charge")) {
      return Response.json({ error: { code: "UNAUTHORIZED", message: PRAVA_LEAK } }, { status: 401 });
    }
    return new Response("{}", { status: 404 });
  });
  const res = await purchaseRoute.POST(
    post("/api/purchase", { runId: a.state.runId }, { cookie: a.cookie, ip: a.ip }),
  );
  const { data } = await read(res);
  assert.equal((data.lastPurchase as { ok: boolean }).ok, false);
  assertClean(JSON.stringify(data));
});

test("revoking a mandate in production needs the operator token", async () => {
  await withEnv(
    { NODE_ENV: "production", APP_URL: APP, RUN_STORE: "memory", PRAVA_REVOKE_DEMO_MANDATE_ID: "mdt_TESTMANDATE000000000001" },
    async () => {
      const created = await productRoute.POST(
        post("/api/product", { name: "P", price: "5", description: "d" }, { ip: freshIp(), origin: APP }),
      );
      const cookie = (created.headers.get("set-cookie") ?? "").split(";")[0];
      const { runId } = (await created.json()) as { runId: string };

      const refused = await read(
        await revokeRoute.POST(post("/api/mandate/revoke", { runId }, { cookie, origin: APP })),
      );
      assert.equal(refused.status, 403);
      assert.equal(refused.data.code, "REVOKE_DISABLED");
      assert.deepEqual(reached("prava.test"), [], "a mandate was cancelled without the operator");

      const token = "a-long-operator-token-1234";
      await withEnv({ DEMO_FORCE: "1", ADMIN_TOKEN: token }, async () => {
        onNetwork(() => Response.json({ error: { message: PRAVA_LEAK } }, { status: 401 }));
        const res = await revokeRoute.POST(
          post("/api/mandate/revoke", { runId }, { cookie, origin: APP, headers: { "x-banditd-admin": token } }),
        );
        const text = await res.text();
        assert.equal(reached("/cancel").length, 1, "with the token the cancel goes out");
        assertClean(text);
      });
    },
  );
});

test("every route ships the anti-framing and no-sniff headers", async () => {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === "/:path*");
  assert.ok(all, "no header rule covers every path");
  const byKey = new Map(all.headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.match(byKey.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(byKey.get("x-frame-options"), "DENY");
  assert.equal(byKey.get("x-content-type-options"), "nosniff");
});
