import { NextResponse } from "next/server";
import { getState, update, audit } from "@/lib/store";
import { researchMarket } from "@/lib/openai";

export const maxDuration = 120;

export async function POST() {
  const product = getState().product;
  if (!product) {
    return NextResponse.json({ error: "no product submitted yet" }, { status: 400 });
  }

  const research = await researchMarket(product);

  const s = update((state) => {
    state.research = research;
  });

  audit(
    "research",
    `Searched the live web and read ${research.sources.length} sources on ${product.name}`,
  );

  return NextResponse.json(s);
}
