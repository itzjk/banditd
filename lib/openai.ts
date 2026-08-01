import OpenAI, { APIError, APIConnectionError, APIUserAbortError } from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { Product, Research, CreativeAngle } from "./store.ts";

export const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-5.6-luna";
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1-mini";

const SEARCH_CONTEXT = (process.env.OPENAI_SEARCH_CONTEXT ?? "low") as "low" | "medium" | "high";

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey, maxRetries: 0 });
  }
  return client;
}

export interface Budget {
  readonly label: string;
  readonly deadline: number;
  readonly total: number;
}

export function startBudget(label: string, totalMs: number): Budget {
  return { label, deadline: Date.now() + totalMs, total: totalMs };
}

export function msLeft(budget: Budget): number {
  return Math.max(0, budget.deadline - Date.now());
}

export class StepFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: string,
    message: string,
    status: number,
    retryAfterSeconds: number | null,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StepFailure";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function failureBody(err: unknown): {
  status: number;
  body: { error: string; code: string; retryAfterSeconds: number | null };
} {
  const failure = err instanceof StepFailure ? err : translate(err, "This step");
  return {
    status: failure.status,
    body: {
      error: failure.message,
      code: failure.code,
      retryAfterSeconds: failure.retryAfterSeconds,
    },
  };
}

const MIN_ATTEMPT_MS = 12000;
const ATTEMPT_CAP_MS = 65000;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerOf(err: unknown, name: string): string | null {
  const raw = (err as { headers?: unknown }).headers;
  if (!raw) return null;
  if (typeof (raw as Headers).get === "function") return (raw as Headers).get(name);
  const record = raw as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };

function parseDuration(text: string): number | null {
  const span = /try again in ((?:[\d.]+\s*(?:ms|s|m|h|d)\s*)+)/i.exec(text);
  if (!span) return null;

  let total = 0;
  let seen = false;
  for (const part of span[1].matchAll(/([\d.]+)\s*(ms|s|m|h|d)/gi)) {
    const scale = UNIT_MS[part[2].toLowerCase()];
    if (scale === undefined) continue;
    total += Number(part[1]) * scale;
    seen = true;
  }
  return seen ? total : null;
}

function waitHintMs(err: unknown): number | null {
  const asMs = Number(headerOf(err, "retry-after-ms"));
  if (Number.isFinite(asMs) && asMs > 0) return asMs;

  const asSeconds = Number(headerOf(err, "retry-after"));
  if (Number.isFinite(asSeconds) && asSeconds > 0) return asSeconds * 1000;

  return parseDuration(err instanceof Error ? err.message : String(err));
}

function limitKind(err: unknown): "tokens" | "requests" | "unknown" {
  const type = (err as { error?: { type?: string } }).error?.type;
  if (type === "tokens" || type === "requests") return type;
  return "unknown";
}

function quotaWindow(err: unknown): string | null {
  const match = /(requests|tokens) per (day|min|minute|hour)/i.exec(
    err instanceof Error ? err.message : String(err),
  );
  return match ? match[0].toLowerCase() : null;
}

function humanWait(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}

function outOfTime(budget: Budget, cause: string): StepFailure {
  return new StepFailure(
    "BUDGET_EXHAUSTED",
    `${budget.label} used its ${Math.round(budget.total / 1000)} second budget without an answer (${cause}). Nothing was charged. Fire this step again in about a minute.`,
    503,
    60,
  );
}

function translate(err: unknown, label: string): StepFailure {
  if (err instanceof StepFailure) return err;

  if (err instanceof APIError && err.status === 429) {
    const hint = waitHintMs(err);
    const seconds = Math.max(1, Math.ceil((hint ?? 60000) / 1000));
    const window = quotaWindow(err);

    if (window === "requests per day") {
      return new StepFailure(
        "DAILY_QUOTA_EXHAUSTED",
        `${label} could not run: the OpenAI account has used its entire daily request allowance for ${TEXT_MODEL}. Nothing was charged, and waiting will not help until the quota resets in about ${humanWait(seconds)}. Add a payment method to the OpenAI account to lift this cap.`,
        503,
        seconds,
        err,
      );
    }

    return new StepFailure(
      "RATE_LIMITED",
      limitKind(err) === "tokens"
        ? `${label} stopped short: the OpenAI account is at its tokens-per-minute ceiling for ${TEXT_MODEL}, and the wait to clear it is longer than this step can hold. Nothing was charged. Run this step again in about ${humanWait(seconds)}.`
        : `${label} stopped short: OpenAI is rate limiting this account${window ? ` on ${window}` : ""}. Nothing was charged. Run this step again in about ${humanWait(seconds)}.`,
      503,
      seconds,
      err,
    );
  }

  if (err instanceof APIError && err.status === 401) {
    return new StepFailure(
      "BAD_CREDENTIALS",
      `${label} could not authenticate with OpenAI. Check OPENAI_API_KEY on the deployment.`,
      500,
      null,
      err,
    );
  }

  if (err instanceof APIError && err.status && err.status >= 500) {
    return new StepFailure(
      "UPSTREAM_DOWN",
      `${label} failed because OpenAI answered ${err.status}. Nothing was charged. Try the step again.`,
      503,
      15,
      err,
    );
  }

  if (err instanceof APIConnectionError) {
    return new StepFailure(
      "UPSTREAM_UNREACHABLE",
      `${label} could not reach OpenAI. Nothing was charged. Try the step again.`,
      503,
      15,
      err,
    );
  }

  if (err instanceof APIError) {
    return new StepFailure(
      "UPSTREAM_REJECTED",
      `${label} was rejected by OpenAI: ${err.message}`,
      502,
      null,
      err,
    );
  }

  return new StepFailure(
    "STEP_FAILED",
    `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
    502,
    null,
    err,
  );
}

function isTimeout(err: unknown): boolean {
  if (err instanceof APIUserAbortError) return true;
  const name = (err as { name?: string }).name;
  return name === "TimeoutError" || name === "AbortError";
}

function retryable(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true;
  if (!(err instanceof APIError)) return false;
  const status = err.status ?? 0;
  if (status === 429) return quotaWindow(err) !== "requests per day";
  return status === 408 || status === 409 || status >= 500;
}

async function withBudget<T>(
  budget: Budget,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    const left = msLeft(budget);
    if (left < MIN_ATTEMPT_MS) throw outOfTime(budget, "no time left for another attempt");

    attempt += 1;
    try {
      return await call(AbortSignal.timeout(Math.min(left, ATTEMPT_CAP_MS)));
    } catch (err) {
      if (isTimeout(err)) {
        if (attempt >= MAX_ATTEMPTS || msLeft(budget) < MIN_ATTEMPT_MS) {
          throw outOfTime(budget, "the model did not answer in time");
        }
        continue;
      }
      if (attempt >= MAX_ATTEMPTS || !retryable(err)) throw translate(err, budget.label);

      const wait = (waitHintMs(err) ?? Math.min(2000 * 2 ** (attempt - 1), 8000)) + 500;
      if (msLeft(budget) - wait < MIN_ATTEMPT_MS) throw translate(err, budget.label);
      await sleep(wait);
    }
  }
}

const ResearchSchema = z.object({
  buyerProfile: z.string(),
  competitorAngles: z.array(z.string()),
  pricePositioning: z.string(),
});

export async function researchMarket(product: Product, budget: Budget): Promise<Research> {
  const res = await withBudget(budget, (signal) =>
    openai().responses.parse(
      {
        model: TEXT_MODEL,
        tools: [{ type: "web_search", search_context_size: SEARCH_CONTEXT }],
        input: [
          {
            role: "system",
            content:
              "You research consumer markets for ad targeting. Search the live web. Be concrete, cite what you find, never invent statistics. Keep each field under 90 words.",
          },
          {
            role: "user",
            content: `Research the market for this product.

Name: ${product.name}
Price: ${product.price}
Description: ${product.description}

Find who actually buys this, the angles competitors use in their ads, and where this price sits against comparable products.`,
          },
        ],
        text: { format: zodTextFormat(ResearchSchema, "market_research") },
        max_output_tokens: 3000,
      },
      { signal },
    ),
  );

  const parsed = res.output_parsed;
  if (!parsed) {
    throw new StepFailure(
      "NO_OUTPUT",
      `${budget.label} came back empty (status ${res.status}, ${res.incomplete_details?.reason ?? "no reason given"}). Nothing was charged. Try the step again.`,
      503,
      10,
    );
  }

  const sources: { title: string; url: string }[] = [];
  for (const item of res.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      for (const ann of part.annotations ?? []) {
        if (ann.type === "url_citation" && !sources.some((s) => s.url === ann.url)) {
          sources.push({ title: ann.title ?? ann.url, url: ann.url });
        }
      }
    }
  }

  return { ...parsed, sources };
}

const ANGLES = ["price", "ritual", "gift", "quality"] as const;

const VariantSchema = z.object({
  angle: z.enum(ANGLES),
  headline: z.string(),
  body: z.string(),
  imagePrompt: z.string(),
  targetEmotion: z.string(),
});

const VariantsSchema = z.object({ variants: z.array(VariantSchema) });

export interface VariantSpec {
  angle: CreativeAngle;
  headline: string;
  body: string;
  imagePrompt: string;
  targetEmotion: string;
}

export async function generateVariants(
  product: Product,
  research: Research,
  budget: Budget,
  parent?: { headline: string; body: string; angle: CreativeAngle },
): Promise<VariantSpec[]> {
  const brief = parent
    ? `One variant is already winning. Produce four NEW variants that keep what makes it work and vary everything else.

Winner angle: ${parent.angle}
Winner headline: ${parent.headline}
Winner body: ${parent.body}`
    : `Produce exactly four variants, one per angle: price, ritual, gift, quality.`;

  const res = await withBudget(budget, (signal) =>
    openai().responses.parse(
      {
        model: TEXT_MODEL,
        input: [
          {
            role: "system",
            content:
              "You write direct response ad creative. Headlines under 60 characters. Body under 140 characters. No exclamation marks, no emoji, no hype words.",
          },
          {
            role: "user",
            content: `Product: ${product.name}
Price: ${product.price}
Description: ${product.description}

Who buys it: ${research.buyerProfile}
Competitor angles: ${research.competitorAngles.join("; ")}
Price positioning: ${research.pricePositioning}

${brief}

For each variant also write an imagePrompt describing a photographic product image, no text in the image.`,
          },
        ],
        text: { format: zodTextFormat(VariantsSchema, "creative_variants") },
        max_output_tokens: 1200,
      },
      { signal },
    ),
  );

  const parsed = res.output_parsed;
  if (!parsed) {
    throw new StepFailure(
      "NO_OUTPUT",
      `${budget.label} came back empty (status ${res.status}). Nothing was charged. Try the step again.`,
      503,
      10,
    );
  }
  return parsed.variants.slice(0, 4);
}

const MIN_IMAGE_MS = 15000;

export async function generateImage(prompt: string, budget: Budget): Promise<string | null> {
  const left = msLeft(budget);
  if (left < MIN_IMAGE_MS) {
    console.warn("image skipped, no time left in the budget");
    return null;
  }
  try {
    const res = await openai().images.generate(
      {
        model: IMAGE_MODEL,
        prompt,
        size: "1024x1024",
        n: 1,
      },
      { signal: AbortSignal.timeout(left) },
    );
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) {
      console.error("image generation returned no data for prompt:", prompt.slice(0, 60));
      return null;
    }
    return `data:image/png;base64,${b64}`;
  } catch (e) {
    console.error("image generation failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface SpendDecision {
  shouldBuy: boolean;
  amount: string | null;
  reason: string;
  abstainedBecause: string | null;
}

export interface DecisionContext {
  arms: { headline: string; angle: string; impressions: number; clicks: number; ctr: string }[];
  candidateIndex: number;
  probabilityBest: number;
  sufficientEvidence: boolean;
  totalImpressions: number;
  mandateRemaining: string;
  mandateScope: string;
  mandateExpiry: string;
  creditPrice: string;
}

export async function decideSpend(ctx: DecisionContext, budget: Budget): Promise<SpendDecision> {
  const res = await withBudget(budget, (signal) =>
    openai().responses.create(
      {
        model: TEXT_MODEL,
        tools: [
          {
            type: "function",
            name: "purchase_render_credits",
            description:
              "Charge the seller's mandate to buy more render credits, so more variants of the winning creative can be generated. Only call this when the statistical evidence genuinely supports it.",
            parameters: {
              type: "object",
              properties: {
                amount: {
                  type: "string",
                  description: "Amount in USD as a decimal string, for example \"4.00\".",
                },
                reason: {
                  type: "string",
                  description:
                    "One plain-language sentence a seller would understand, citing the winning variant, its probability of being best, and the impressions behind it.",
                },
              },
              required: ["amount", "reason"],
              additionalProperties: false,
            },
            strict: true,
          },
        ],
        tool_choice: "auto",
        parallel_tool_calls: false,
        input: [
          {
            role: "system",
            content:
              "You decide whether to spend a seller's money on more ad render credits. You are spending real money under a mandate the seller set. Buy only when the evidence is sufficient. If it is not, do not call the tool, and explain what you are still waiting for.",
          },
          {
            role: "user",
            content: `Creative variants under test (performance data is simulated):
${ctx.arms
  .map(
    (a, i) =>
      `  [${i}] ${a.angle} — "${a.headline}" — ${a.clicks}/${a.impressions} clicks (${a.ctr} CTR)${i === ctx.candidateIndex ? "  <- current candidate" : ""}`,
  )
  .join("\n")}

Bandit evaluation:
  candidate: variant ${ctx.candidateIndex}
  probability it is truly best: ${(ctx.probabilityBest * 100).toFixed(1)}%
  evidence gate passed: ${ctx.sufficientEvidence}
  total impressions: ${ctx.totalImpressions}

Mandate constraints:
  remaining budget: ${ctx.mandateRemaining}
  merchant scope: ${ctx.mandateScope}
  expires: ${ctx.mandateExpiry}

A pack of render credits costs ${ctx.creditPrice}.`,
          },
        ],
      },
      { signal },
    ),
  );

  for (const item of res.output ?? []) {
    if (item.type === "function_call" && item.name === "purchase_render_credits") {
      const args = JSON.parse(item.arguments) as { amount: string; reason: string };
      return {
        shouldBuy: true,
        amount: args.amount,
        reason: args.reason,
        abstainedBecause: null,
      };
    }
  }

  return {
    shouldBuy: false,
    amount: null,
    reason: "",
    abstainedBecause: res.output_text || "Evidence is not sufficient yet.",
  };
}
