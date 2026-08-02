import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { interpretBrief, startBudget, failureBody } from "@/lib/openai";
import { priceLabel } from "@/lib/store";
import { searchCatalog } from "@/lib/catalog";

export const maxDuration = 120;

const BUDGET_MS = Number(process.env.INTERPRET_BUDGET_MS ?? 45000);
const MAX_SENTENCE = 400;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 300;
const MAX_QUESTION = 180;

const NOTHING_TYPED = "Write one line about what you sell, with the price in it.";

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}...` : text;
}

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const sentence = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";

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

  const budget = startBudget("Reading your sentence", BUDGET_MS);
  const started = Date.now();

  try {
    const reading = await interpretBrief(sentence.slice(0, MAX_SENTENCE), budget);

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

    const name = clip(reading.name, MAX_NAME);
    const price = reading.price ? priceLabel(clip(reading.price, 24)) : "";
    const description = clip(reading.description, MAX_DESCRIPTION);
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
    const { status, body: payload } = failureBody(err);
    console.error(
      `interpret gave up after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
      err,
    );
    return NextResponse.json(payload, { status });
  }
}
