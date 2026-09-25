import { z } from "zod";
import {
  RUN_ID_SHAPE,
  MAX_PRODUCT_NAME,
  MAX_PRODUCT_PRICE,
  MAX_PRODUCT_DESCRIPTION,
  MAX_MARKET_CONTEXT,
  MAX_REFINEMENT,
} from "./state-schema.ts";

/**
 * What every route accepts, and nothing more. Objects are strict: a field the
 * contract does not name (a whole `state`, a click count, a credit balance) is
 * refused with a 400 that says which one, instead of being read or ignored.
 * The run itself lives on the server; a request names it with `runId`.
 */

const runId = z.string().regex(RUN_ID_SHAPE, "is not a run id this server issues");

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "is empty")
    .max(max, `is longer than the ${max} characters allowed`);

export const MIN_IMPRESSIONS_PER_CALL = 100;
export const MAX_IMPRESSIONS_PER_CALL = 400_000;

export const ProductCreate = z.strictObject({
  name: line(MAX_PRODUCT_NAME),
  price: line(MAX_PRODUCT_PRICE),
  description: line(MAX_PRODUCT_DESCRIPTION),
  marketContext: z
    .string()
    .max(MAX_MARKET_CONTEXT, `is longer than the ${MAX_MARKET_CONTEXT} characters allowed`)
    .optional(),
});

export const ProductEdit = z
  .strictObject({
    runId,
    price: line(MAX_PRODUCT_PRICE).optional(),
    description: line(MAX_PRODUCT_DESCRIPTION).optional(),
    variant: z.string().trim().max(MAX_REFINEMENT).optional(),
    brand: z.string().trim().max(MAX_REFINEMENT).optional(),
  })
  .refine(
    (edit) => [edit.price, edit.description, edit.variant, edit.brand].some((v) => v !== undefined),
    "names no field to change",
  );

export const RunOnly = z.strictObject({ runId });

export const CreativesInput = z.strictObject({
  runId,
  parentId: z.string().min(1).max(80).optional(),
});

export const SimulateInput = z.strictObject({
  runId,
  impressions: z
    .int("has to be a whole number of impressions")
    .min(MIN_IMPRESSIONS_PER_CALL, `has to be at least ${MIN_IMPRESSIONS_PER_CALL}`)
    .max(MAX_IMPRESSIONS_PER_CALL, `has to be at most ${MAX_IMPRESSIONS_PER_CALL}`),
});

export const ImageInput = z.strictObject({
  runId,
  creativeId: z.string().min(1).max(80),
});

export const VariantImageInput = z.strictObject({
  runId,
  variant: line(MAX_REFINEMENT),
});

export const PurchaseInput = z.strictObject({
  runId,
  amount: z
    .string()
    .regex(/^\d{1,4}(\.\d{1,2})?$/, 'has to be a decimal string such as "4.00"')
    .optional(),
  reason: z.string().trim().max(600).optional(),
  force: z.union([z.literal(true), z.literal("merchant")]).optional(),
});

export const PlanInput = z.strictObject({
  runId,
  cycle: z.int().min(1).max(100),
  progress: z.strictObject({
    researched: z.boolean(),
    wrote: z.boolean(),
    decided: z.boolean(),
    purchaseAttempts: z.int().min(0).max(100),
    purchased: z.boolean(),
    evolved: z.boolean(),
    retested: z.boolean(),
    looksTaken: z.int().min(0).max(1000),
    looksLeft: z.int().min(0).max(1000),
  }),
  history: z.array(z.string().max(2000)).max(100),
  lastDecision: z.string().max(4000).nullable(),
  lastPurchase: z.string().max(4000).nullable(),
});

const ChatMessage = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

export const ChatInput = z.union([
  z.strictObject({ runId, messages: z.array(ChatMessage).min(1).max(40) }),
  z.strictObject({
    runId,
    responseId: z.string().regex(/^resp_[A-Za-z0-9_-]{6,200}$/),
    outputs: z
      .array(
        z.strictObject({
          callId: z.string().regex(/^call_[A-Za-z0-9_-]{4,120}$/),
          output: z.string().max(6000),
        }),
      )
      .min(1)
      .max(4),
  }),
]);

export const ChatToolInput = z.strictObject({
  runId,
  tool: z.enum(["read_run", "read_mandate_limits", "explain_last_decision"]),
});

export const InterpretInput = z.strictObject({
  text: z.string().max(400, "is longer than the 400 characters read"),
});

export const MerchantInput = z.strictObject({
  domain: line(253),
  query: z.string().max(120).optional(),
  country: z.string().max(2).optional(),
  version: z.string().max(10).nullable().optional(),
});

export const ExportInput = z.strictObject({
  runId,
  format: z.enum(["json", "csv"]).optional(),
  section: z.enum(["creatives", "purchases", "audit", "research", "all"]).optional(),
});
