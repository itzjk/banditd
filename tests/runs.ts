// Builders for tests that need a real run on the server.
import assert from "node:assert/strict";
import { freshIp, post } from "./helpers.ts";
import * as productRoute from "../app/api/product/route.ts";
import { updateRun } from "../lib/run-store.ts";
import type { Creative, State } from "../lib/store.ts";

export interface Browser {
  ip: string;
  cookie: string;
  sid: string;
  state: State;
}

export async function startRun(ip = freshIp()): Promise<Browser> {
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
export async function seedCreatives(browser: Browser, credits?: number) {
  await updateRun(browser.state.runId, { ip: browser.ip, sid: browser.sid }, ({ state }) => {
    state.creatives.push(creative("cr_t_0"), creative("cr_t_1"), creative("cr_t_2"), creative("cr_t_3"));
    if (credits !== undefined) state.credits.balance = credits;
  });
}

