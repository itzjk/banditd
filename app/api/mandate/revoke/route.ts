import { NextResponse } from "next/server";
import { openSession, commit, logAudit } from "@/lib/store";
import { cancelMandate, PravaError } from "@/lib/prava";

export const maxDuration = 30;

interface RevokeBody {
  mandateId?: string;
  state?: unknown;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as RevokeBody;

  const session = openSession(body.state);
  const state = session.state;
  const mandateId = body.mandateId?.trim() || state.mandateId;

  if (!mandateId) {
    return NextResponse.json(
      {
        error:
          "there is no mandate on file to revoke. The seller has to sign one before there is anything to take back.",
        code: "NO_MANDATE_ON_FILE",
      },
      { status: 400 },
    );
  }

  try {
    const mandate = await cancelMandate(mandateId);

    logAudit(
      state,
      "mandate",
      `Seller revoked the mandate ${mandateId}: Prava reports it as ${mandate.status}. Every future charge attempt dies before it reaches a card, past charges stand.`,
    );

    return NextResponse.json({
      ...commit(session),
      revoked: { mandateId, status: mandate.status },
    });
  } catch (e) {
    if (e instanceof PravaError) {
      return NextResponse.json(
        {
          error: `Prava refused to revoke mandate ${mandateId}: ${e.message}`,
          code: e.code,
        },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 },
      );
    }
    return NextResponse.json(
      {
        error: `Revoking mandate ${mandateId} failed on the way to Prava: ${e instanceof Error ? e.message : String(e)}`,
        code: "REVOKE_FAILED",
      },
      { status: 502 },
    );
  }
}
