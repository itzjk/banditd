import { NextResponse } from "next/server";
import { readMandateFacts } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const read = await readMandateFacts(id);
  return NextResponse.json(read, { headers: { "cache-control": "no-store" } });
}
