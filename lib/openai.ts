import OpenAI from "openai";
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
    client = new OpenAI({ apiKey, maxRetries: 2, timeout: 90000 });
  }
  return client;
}

const ResearchSchema = z.object({
  buyerProfile: z.string(),
  competitorAngles: z.array(z.string()),
  pricePositioning: z.string(),
});

export async function researchMarket(product: Product): Promise<Research> {
  const res = await openai().responses.parse({
    model: TEXT_MODEL,
    tools: [{ type: "web_search", search_context_size: SEARCH_CONTEXT }],
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content:
          "You research consumer markets for ad targeting. Search the live web. Be concrete and cite what you find. Never invent statistics.",
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
    max_output_tokens: 4000,
  });

  const parsed = res.output_parsed;
  if (!parsed) {
    throw new Error(
      `research returned no structured output (status=${res.status}, reason=${res.incomplete_details?.reason ?? "none"})`,
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
  parent?: { headline: string; body: string; angle: CreativeAngle },
): Promise<VariantSpec[]> {
  const brief = parent
    ? `One variant is already winning. Produce four NEW variants that keep what makes it work and vary everything else.

Winner angle: ${parent.angle}
Winner headline: ${parent.headline}
Winner body: ${parent.body}`
    : `Produce exactly four variants, one per angle: price, ritual, gift, quality.`;

  const res = await openai().responses.parse({
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
  });

  const parsed = res.output_parsed;
  if (!parsed) throw new Error("creatives returned no structured output");
  return parsed.variants.slice(0, 4);
}

export async function generateImage(prompt: string): Promise<string | null> {
  try {
    const res = await openai().images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: "1024x1024",
      n: 1,
    });
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

export async function decideSpend(ctx: DecisionContext): Promise<SpendDecision> {
  const res = await openai().responses.create({
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
  });

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
