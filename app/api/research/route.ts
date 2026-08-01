import { NextResponse } from "next/server";
import { openSession, commit, logAudit } from "@/lib/store";
import { researchMarket } from "@/lib/openai";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { state?: unknown };
  const session = openSession(body.state);

  const product = session.state.product;
  if (!product) {
    return NextResponse.json({ error: "no product submitted yet" }, { status: 400 });
  }

  const research = await researchMarket(product);
  session.state.research = research;

  logAudit(
    session.state,
    "research",
    `Searched the live web and read ${research.sources.length} sources on ${product.name}`,
  );

  return NextResponse.json(commit(session));
}
