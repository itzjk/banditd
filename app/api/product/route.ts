import { NextResponse } from "next/server";
import { getState, update, audit, reset } from "@/lib/store";

export async function GET() {
  return NextResponse.json(getState());
}

export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string; price?: string; description?: string };

  if (!body.name || !body.price || !body.description) {
    return NextResponse.json(
      { error: "name, price and description are required" },
      { status: 400 },
    );
  }

  const mandateId = getState().mandateId;
  reset();

  const s = update((state) => {
    state.mandateId = mandateId;
    state.product = {
      name: body.name!.trim(),
      price: body.price!.trim(),
      description: body.description!.trim(),
    };
  });

  audit("product", `Seller submitted "${s.product!.name}" at ${s.product!.price}`);

  return NextResponse.json(s);
}
