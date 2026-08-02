import { NextResponse } from "next/server";
import { openSession, commit, logAudit } from "@/lib/store";
import { refineProduct, startBudget, failureBody } from "@/lib/openai";

export const maxDuration = 300;

const BUDGET_MS = Number(process.env.REFINE_BUDGET_MS ?? 60000);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { state?: unknown };
  const session = openSession(body.state);

  const product = session.state.product;
  if (!product) {
    return NextResponse.json({ error: "no product submitted yet" }, { status: 400 });
  }

  const budget = startBudget("The product options", BUDGET_MS);
  const started = Date.now();

  try {
    const options = await refineProduct(product, budget);
    session.state.productOptions = options;

    logAudit(
      session.state,
      "refine",
      `Listed ${options.variants.length} variants and ${options.brands.length} brands for "${product.name}" so the seller can aim the run before it starts`,
    );

    return NextResponse.json(commit(session));
  } catch (err) {
    const { status, body: payload } = failureBody(err);
    console.error(
      `refine gave up after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
      err,
    );
    return NextResponse.json(payload, { status });
  }
}
