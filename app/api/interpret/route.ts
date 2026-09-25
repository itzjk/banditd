import { NextResponse } from "next/server";
import { interpretBrief, startBudget } from "@/lib/openai";
import { priceLabel, MAX_PRODUCT_NAME, MAX_PRODUCT_DESCRIPTION, MAX_PRODUCT_PRICE } from "@/lib/store";
import { searchCatalog } from "@/lib/catalog";
import { guard } from "@/lib/access";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { InterpretInput } from "@/lib/contracts";

export const maxDuration = 120;

const BUDGET_MS = Number(process.env.INTERPRET_BUDGET_MS ?? 45000);
const MAX_QUESTION = 180;

const NOTHING_TYPED = "Write one line about what you sell, with the price in it.";

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

export async function POST(req: Request) {
  const started = Date.now();
  try {
    await guard(req, "model");
    const body = await readJson(req, InterpretInput);
    const sentence = body.text.replace(/\s+/g, " ").trim();

    if (!sentence) {
      return NextResponse.json({
        understood: false,
        name: "",
        price: "",
        description: "",
        question: NOTHING_TYPED,
        estimate: null,
      });
    }

    const reading = await interpretBrief(sentence, startBudget("Reading your sentence", BUDGET_MS));

    if (!reading.understood || !reading.name) {
      return NextResponse.json({
        understood: false,
        name: "",
        price: "",
        description: "",
        question: clip(reading.question, MAX_QUESTION) || NOTHING_TYPED,
        estimate: null,
      });
    }

    const name = clip(reading.name, MAX_PRODUCT_NAME);
    const price = reading.price ? priceLabel(clip(reading.price, MAX_PRODUCT_PRICE - 1)) : "";
    const description = clip(reading.description, MAX_PRODUCT_DESCRIPTION);
    const known = price ? null : (searchCatalog(name, 1)[0] ?? null);

    return NextResponse.json({
      understood: true,
      name,
      price,
      description,
      question: "",
      estimate: known ? { price: known.price, name: known.name } : null,
    });
  } catch (err) {
    if (!(err instanceof HttpFailure)) {
      console.error(`interpret gave up after ${Math.round((Date.now() - started) / 1000)}s`, err);
    }
    return failure(err);
  }
}
