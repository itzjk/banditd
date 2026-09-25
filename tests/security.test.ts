// Findings from the review, written against the public surface (route
// handlers and lib exports that exist before and after the fix), so the same
// file fails on the old code and passes on the new one.
import { APP, clearNetwork, forgedState, freshIp, post, reached, read, withEnv, onNetwork } from "./helpers.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { fromOurPage } from "../lib/same-origin.ts";
import { evaluate } from "../lib/bandit.ts";
import { getMandate } from "../lib/prava.ts";
import { mandateQueue } from "../lib/mandate.ts";
import * as productRoute from "../app/api/product/route.ts";
import * as researchRoute from "../app/api/research/route.ts";
import * as imageRoute from "../app/api/image/route.ts";
import * as simulateRoute from "../app/api/simulate/route.ts";
import * as purchaseRoute from "../app/api/purchase/route.ts";

beforeEach(() => clearNetwork());

const production = { NODE_ENV: "production", APP_URL: APP, RENDER_MERCHANT_URL: APP, RUN_STORE: "memory" };

test("in production a localhost Origin does not pass the same-site check", async () => {
  await withEnv(production, async () => {
    const from = (origin: string) =>
      fromOurPage(new Request(`${APP}/api/research`, { method: "POST", headers: { origin } }));
    assert.equal(from("http://localhost"), false, "localhost is not this site in production");
    assert.equal(from("http://127.0.0.1:3000"), false);
    assert.equal(from("https://evil.example"), false);
    assert.equal(from(APP), true, "the configured site still passes");
  });
});

test("a forged credit ledger in the body never reaches the image model", async () => {
  const res = await imageRoute.POST(
    post(
      "/api/image",
      { creativeId: "cr_a", imagePrompt: "anything the caller wants rendered", state: forgedState() },
      { ip: freshIp() },
    ),
  );
  const { status } = await read(res);
  assert.deepEqual(reached("openai.com"), [], "the model was called on a ledger the caller wrote");
  assert.ok(status >= 400 && status < 500, `expected a refusal, got ${status}`);
});

test("a forged cohort cannot open the gates and reach a mandate", async () => {
  const res = await purchaseRoute.POST(
    post("/api/purchase", { amount: "4.00", state: forgedState() }, { ip: freshIp() }),
  );
  const { status } = await read(res);
  assert.deepEqual(reached("prava.test"), [], "Prava was called on click counts the caller wrote");
  assert.ok(status >= 400, `expected a refusal, got ${status}`);
});

test("force:true does not reach a mandate in production", async () => {
  await withEnv(production, async () => {
    const res = await purchaseRoute.POST(
      post("/api/purchase", { force: true, state: forgedState() }, { ip: freshIp(), origin: APP }),
    );
    const { status } = await read(res);
    assert.deepEqual(reached("prava.test"), [], "a forced charge left for Prava in production");
    assert.ok(status >= 400, `expected a refusal, got ${status}`);
  });
});

test("impressions that are not a whole number are refused, not concatenated", async () => {
  const res = await simulateRoute.POST(
    post("/api/simulate", { impressions: "abc", state: forgedState() }, { ip: freshIp() }),
  );
  const { status, data } = await read(res);
  assert.equal(status, 400, `simulate answered ${status} with ${JSON.stringify(data).slice(0, 120)}`);
});

test("one browser's run is invisible to another browser", async () => {
  const created = await productRoute.POST(
    post(
      "/api/product",
      { name: "Secret product of A", price: "12", description: "only A should see this" },
      { ip: freshIp() },
    ),
  );
  assert.equal(created.status, 200);

  const exported = productRoute as Record<string, unknown>;
  if (typeof exported.GET === "function") {
    const seen = await (exported.GET as (req: Request) => Promise<Response>)(
      new Request("http://localhost:3000/api/product"),
    );
    assert.doesNotMatch(await seen.text(), /Secret product of A/, "GET handed A's run to B");
  }

  clearNetwork();
  const other = await researchRoute.POST(post("/api/research", {}, { ip: freshIp() }));
  assert.ok(other.status >= 400, `B's research on no run answered ${other.status}`);
  assert.equal(
    reached("openai.com").filter((o) => o.body.includes("Secret product of A")).length,
    0,
    "B's request sent A's product to the model",
  );
});

test("a product description of two million characters is refused", async () => {
  const res = await productRoute.POST(
    post(
      "/api/product",
      { name: "Big", price: "10", description: "x".repeat(2_000_000) },
      { ip: freshIp() },
    ),
  );
  assert.ok(res.status === 400 || res.status === 413, `answered ${res.status}`);
});

test("a mandate id cannot walk out of /v1/mandates/", async () => {
  await getMandate("../sessions?").catch(() => undefined);
  for (const call of reached("prava.test")) {
    assert.match(new URL(call.url).pathname, /^\/v1\/mandates\//, `the secret key was sent to ${call.url}`);
  }
});

test("a real mandate signed for 5.00 is not taken for the rejection demo by its amount", async () => {
  onNetwork((url) =>
    url.includes("/v1/mandates")
      ? Response.json([
          {
            id: "mdt_01KZ0KP8EEDFRP425E74Y6HSJ0",
            status: "active",
            approvedAmount: "5.00",
            remaining: "5.00",
            merchantName: "Banditd Render Credits",
          },
        ])
      : new Response("{}", { status: 404 }),
  );
  await withEnv({ PRAVA_REJECTION_MANDATE_ID: undefined }, async () => {
    const queue = await mandateQueue(4, null, "seller_test");
    assert.deepEqual(
      queue.candidates.map((c) => c.id),
      ["mdt_01KZ0KP8EEDFRP425E74Y6HSJ0"],
      "the seller's 5.00 mandate dropped out of the charge queue",
    );
    assert.equal(queue.reserved, null);
  });
});

test("one arm is not a comparison: every gate stays shut", () => {
  const verdict = evaluate([{ impressions: 5000, clicks: 250 }]);
  assert.equal(verdict.sufficientEvidence, false);
  assert.equal(verdict.thresholdMet, false);
  assert.ok(Number.isFinite(verdict.eValue), "eValue has to survive JSON");
});
