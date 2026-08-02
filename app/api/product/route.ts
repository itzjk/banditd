import { NextResponse } from "next/server";
import {
  getState,
  openSession,
  commit,
  logAudit,
  emptyState,
  sanitizeMarketContext,
  marketLinks,
} from "@/lib/store";

interface ProductBody {
  name?: string;
  price?: string;
  description?: string;
  marketContext?: string;
  state?: unknown;
}

export async function GET() {
  return NextResponse.json(getState());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ProductBody;

  if (!body.name || !body.price || !body.description) {
    return NextResponse.json(
      { error: "name, price and description are required" },
      { status: 400 },
    );
  }

  const session = openSession(body.state);
  const mandateId = session.state.mandateId;
  const marketContext = sanitizeMarketContext(body.marketContext);

  session.state = {
    ...emptyState(),
    mandateId,
    product: {
      name: body.name.trim(),
      price: body.price.trim(),
      description: body.description.trim(),
      marketContext,
    },
  };

  logAudit(
    session.state,
    "credits",
    "Starter grant, 4 renders: the first generation is on the house, every render after that has to be bought through the mandate",
  );

  logAudit(
    session.state,
    "product",
    `Seller submitted "${session.state.product!.name}" at ${session.state.product!.price}`,
  );

  if (marketContext) {
    const links = marketLinks(marketContext);
    logAudit(
      session.state,
      "product",
      `Seller market note attached, ${marketContext.length} characters, ${links.length} reference ${links.length === 1 ? "link" : "links"}. It steers research and copy only, and is treated as untrusted context, never as instructions`,
    );
  }

  return NextResponse.json(commit(session));
}
