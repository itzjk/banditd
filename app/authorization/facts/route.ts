import { NextResponse } from "next/server";
import { readMandateFacts } from "@/lib/authorization";
import { limit } from "@/lib/access";
import { failure } from "@/lib/http";
import { isMandateId } from "@/lib/prava";

export const dynamic = "force-dynamic";

// The same mandate facts the public /authorization page shows, read live from
// Prava. Each read is a call on the operator's key, so it is rate limited.
export async function GET(req: Request) {
  try {
    await limit(req, "read");
    const id = new URL(req.url).searchParams.get("id");
    const read = await readMandateFacts(isMandateId(id) ? id : null);
    return NextResponse.json(read, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return failure(err);
  }
}
