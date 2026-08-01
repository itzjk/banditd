import { NextResponse } from "next/server";
import { getState, openSession, commit, logAudit, emptyState } from "@/lib/store";

interface ProductBody {
  name?: string;
  price?: string;
  description?: string;
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

  session.state = {
    ...emptyState(),
    mandateId,
    product: {
      name: body.name.trim(),
      price: body.price.trim(),
      description: body.description.trim(),
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

  return NextResponse.json(commit(session));
}
