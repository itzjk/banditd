import { clearNetwork, onNetwork, reached } from "./helpers.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { isPublicAddress, publicFetch, BlockedDestination } from "../lib/public-fetch.ts";
import { csvCell } from "../lib/csv.ts";
import { getMandate } from "../lib/prava.ts";
import {
  evaluate,
  sampleBeta,
  createRng,
  logGamma,
  logCohortBayesFactor,
  EVIDENCE_CALIBRATION,
} from "../lib/bandit.ts";

beforeEach(() => clearNetwork());

test("addresses off the public internet are recognised", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("a public-looking name that resolves to a private address is not fetched", async () => {
  await assert.rejects(
    publicFetch("https://127.0.0.1.nip.io/.well-known/ucp", {}, async () => ["127.0.0.1"]),
    BlockedDestination,
  );
  assert.deepEqual(reached("nip.io"), []);
});

test("a redirect to a private address is not followed", async () => {
  onNetwork(() => new Response(null, { status: 302, headers: { location: "http://10.0.0.5/admin" } }));
  const lookup = async (host: string) => (host === "shop.example" ? ["93.184.216.34"] : ["10.0.0.5"]);
  await assert.rejects(publicFetch("https://shop.example/.well-known/ucp", {}, lookup), BlockedDestination);
  assert.equal(reached("10.0.0.5").length, 0);
});

test("CSV cells that a spreadsheet would run as formulas open as text", () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell("+1+1"), "'+1+1");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell(-3), "-3", "a number stays a number");
  assert.equal(csvCell("plain"), "plain");
});

test("a valid mandate id is sent encoded inside /v1/mandates/", async () => {
  onNetwork(() => Response.json({ id: "mdt_01KZ0KP8EEDFRP425E74Y6HSJ0", status: "active" }));
  await getMandate("mdt_01KZ0KP8EEDFRP425E74Y6HSJ0");
  assert.equal(new URL(reached("prava.test")[0].url).pathname, "/v1/mandates/mdt_01KZ0KP8EEDFRP425E74Y6HSJ0");
});

test("the Beta sampler matches the analytic moments", () => {
  const rng = createRng(12345);
  for (const [a, b] of [
    [0.5, 0.5],
    [0.5, 50.5],
    [30.5, 970.5],
    [201, 4801],
  ]) {
    const n = 60000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = sampleBeta(a, b, rng);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const tm = a / (a + b);
    const tv = (a * b) / ((a + b) ** 2 * (a + b + 1));
    assert.ok(Math.abs(mean - tm) / Math.sqrt(tv / n) < 4.5, `Beta(${a},${b}) mean ${mean} vs ${tm}`);
    assert.ok(Math.abs(variance - tv) / tv < 0.05, `Beta(${a},${b}) variance ${variance} vs ${tv}`);
  }
});

function logBinomPmf(n: number, k: number, p: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p);
}

/** E[e-value] under a point null, enumerated exactly over both arms. */
function nullExpectation(n1: number, n2: number, p: number): number {
  const band = (n: number) => {
    const sd = Math.sqrt(n * p * (1 - p));
    const lo = Math.max(0, Math.floor(n * p - 11 * sd - 6));
    const hi = Math.min(n, Math.ceil(n * p + 11 * sd + 6));
    return { lo, w: Array.from({ length: hi - lo + 1 }, (_, i) => Math.exp(logBinomPmf(n, lo + i, p))) };
  };
  const a = band(n1);
  const b = band(n2);
  let acc = 0;
  for (let i = 0; i < a.w.length; i++) {
    for (let j = 0; j < b.w.length; j++) {
      const w = a.w[i] * b.w[j];
      if (w < 1e-15) continue;
      acc +=
        w *
        Math.exp(
          logCohortBayesFactor([
            { impressions: n1, clicks: a.lo + i },
            { impressions: n2, clicks: b.lo + j },
          ]),
        );
    }
  }
  return acc / EVIDENCE_CALIBRATION;
}

test("the e-value is an e-value: its expectation under no difference stays at or below 1", () => {
  for (const [n1, n2, p] of [
    [200, 200, 0.02],
    [500, 500, 0.004],
    [300, 1200, 0.02],
    [200, 200, 0.12],
  ]) {
    const expectation = nullExpectation(n1, n2, p);
    assert.ok(expectation <= 1.0001, `E[e] = ${expectation} at ${n1}/${n2}, p=${p}`);
  }
});

test("two identical arms do not open the gates", () => {
  const verdict = evaluate(
    [
      { impressions: 4000, clicks: 120 },
      { impressions: 4000, clicks: 120 },
    ],
    { rng: createRng(7), samples: 5000 },
  );
  assert.equal(verdict.sufficientEvidence, false);
  assert.equal(verdict.cohortProblem, null);
});
