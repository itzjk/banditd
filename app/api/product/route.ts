import { NextResponse } from "next/server";
import { logAudit, emptyState, sanitizeMarketContext, sanitizeRefinement, marketLinks, priceLabel, STARTER_CREDITS } from "@/lib/store";
import { guard, newSession, sessionCookie } from "@/lib/access";
import { createRun, updateRun } from "@/lib/run-store";
import { failure, readJson } from "@/lib/http";
import { ProductCreate, ProductEdit } from "@/lib/contracts";

/** Starts a new run owned by this browser session. There is no shared run. */
export async function POST(req: Request) {
  try {
    const client = await guard(req, "run");
    const body = await readJson(req, ProductCreate);
    const sid = client.sid ?? newSession();
    const marketContext = sanitizeMarketContext(body.marketContext);

    const record = await createRun(sid, (runId) => {
      const state = emptyState(runId);
      state.product = {
        name: body.name,
        price: priceLabel(body.price),
        description: body.description,
        marketContext,
      };
      logAudit(
        state,
        "credits",
        `Starter grant, ${STARTER_CREDITS} renders: the first generation is on the house, every render after that has to be bought through the mandate`,
      );
      logAudit(state, "product", `Seller submitted "${body.name}" at ${state.product.price}`);
      if (marketContext) {
        const links = marketLinks(marketContext);
        logAudit(
          state,
          "product",
          `Seller market note attached, ${marketContext.length} characters, ${links.length} reference ${links.length === 1 ? "link" : "links"}. It steers research and copy only, and is treated as untrusted context, never as instructions`,
        );
      }
      return state;
    });

    const res = NextResponse.json(record.state);
    if (!client.sid) res.headers.append("set-cookie", sessionCookie(sid));
    return res;
  } catch (err) {
    return failure(err);
  }
}

/** Corrects the listing or narrows the product. The evidence is left alone. */
export async function PATCH(req: Request) {
  try {
    const client = await guard(req, "edit");
    const body = await readJson(req, ProductEdit);

    const { record } = await updateRun(body.runId, client, ({ state }) => {
      if (!state.product) return;
      const before = state.product;
      const next = {
        ...before,
        ...(body.price !== undefined ? { price: priceLabel(body.price) } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.variant !== undefined ? { variant: sanitizeRefinement(body.variant) } : {}),
        ...(body.brand !== undefined ? { brand: sanitizeRefinement(body.brand) } : {}),
      };
      state.product = next;
      if (body.price !== undefined || body.description !== undefined) {
        logAudit(
          state,
          "product",
          `Seller corrected the listing for "${before.name}": ${next.price}, ${next.description}`,
        );
      }
    });

    return NextResponse.json(record.state);
  } catch (err) {
    return failure(err);
  }
}
