import { NextResponse } from "next/server";
import { logAudit } from "@/lib/store";
import { cancelMandate, PravaError } from "@/lib/prava";
import { guard, operatorAllowed } from "@/lib/access";
import { safeError, logUpstream } from "@/lib/redact";
import type { Client } from "@/lib/access";
import { readRun, updateRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { RunOnly } from "@/lib/contracts";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const client = await guard(req, "purchase");
    const { runId } = await readJson(req, RunOnly);
    await readRun(runId, client);
    if (!operatorAllowed(req)) {
      throw new HttpFailure(
        "REVOKE_DISABLED",
        403,
        "Revoking a mandate cannot be undone, so on this deployment it is an operator action: it needs DEMO_FORCE=1 and the operator's admin token. Nothing was revoked.",
      );
    }
    return await revoke(runId, client);
  } catch (err) {
    return failure(err);
  }
}

async function revoke(runId: string, client: Client) {
  const mandateId = (process.env.PRAVA_REVOKE_DEMO_MANDATE_ID ?? "").trim();

  if (!mandateId) {
    return NextResponse.json(
      {
        error:
          "This deployment has no mandate set aside for the revocation demo, so there is nothing this endpoint is allowed to cancel. Revoking a live mandate is done by the seller in their own Prava account, not from here: this app has no sign in, so it never accepts a mandate id from the caller and can only touch the one the operator nominated.",
        code: "REVOKE_NOT_ARMED",
      },
      { status: 403 },
    );
  }

  try {
    const mandate = await cancelMandate(mandateId);

    const { record } = await updateRun(runId, client, ({ state }) =>
      logAudit(
        state,
        "mandate",
        `Seller revoked the mandate ${mandateId}: Prava reports it as ${mandate.status}. Every future charge attempt dies before it reaches a card, past charges stand.`,
      ),
    );

    return NextResponse.json({
      ...record.state,
      revoked: { mandateId, status: mandate.status },
    });
  } catch (e) {
    logUpstream(`prava cancel ${mandateId}`, e);
    if (e instanceof PravaError) {
      return NextResponse.json(
        {
          error: `Prava refused to revoke mandate ${mandateId}: ${safeError(e)}`,
          code: e.code,
        },
        { status: e.status >= 400 && e.status < 600 ? e.status : 502 },
      );
    }
    return NextResponse.json(
      {
        error: `Revoking mandate ${mandateId} failed on the way to Prava: ${safeError(e)}`,
        code: "REVOKE_FAILED",
      },
      { status: 502 },
    );
  }
}
