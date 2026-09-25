import { NextResponse } from "next/server";
import type { State } from "@/lib/state-schema";
import { guard } from "@/lib/access";
import { readRun } from "@/lib/run-store";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { ExportInput } from "@/lib/contracts";
import { csvRows as rows } from "@/lib/csv";

type Section = "creatives" | "purchases" | "audit" | "research" | "all";
type Format = "json" | "csv";

const DISCLOSURE =
  "Impressions, clicks and CTR in this file come from the simulated traffic model inside banditd, not from a live ad platform. Product, research, sources, charges and mandate ids are real.";

function rate(impressions: number, clicks: number): number {
  return impressions > 0 ? clicks / impressions : 0;
}

function slug(value: string | undefined): string {
  const cleaned = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || "run";
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderedIds(state: State): Set<string> {
  const net = new Map<string, number>();
  for (const e of state.credits.entries) {
    if (e.kind === "render") net.set(e.ref, (net.get(e.ref) ?? 0) + 1);
    if (e.kind === "refund") net.set(e.ref, (net.get(e.ref) ?? 0) - 1);
  }
  return new Set([...net].filter(([, n]) => n > 0).map(([id]) => id));
}


function creativeRows(state: State): string {
  const rendered = renderedIds(state);
  return rows(
    [
      "id",
      "generation",
      "parent_id",
      "angle",
      "headline",
      "body",
      "target_emotion",
      "image_prompt",
      "has_image",
      "impressions_simulated",
      "clicks_simulated",
      "ctr_simulated",
    ],
    state.creatives.map((c) => [
      c.id,
      c.generation,
      c.parentId ?? "",
      c.angle,
      c.headline,
      c.body,
      c.targetEmotion,
      c.imagePrompt,
      rendered.has(c.id) ? "yes" : "no",
      c.arm.impressions,
      c.arm.clicks,
      rate(c.arm.impressions, c.arm.clicks).toFixed(4),
    ]),
  );
}

function purchaseRows(state: State): string {
  return rows(
    ["id", "at", "outcome", "amount_usd", "reason", "winner_id", "probability_best", "impressions_simulated", "error_code", "card_last4", "transaction_id", "mandate_id"],
    state.purchases.map((p) => [
      p.id,
      p.at,
      p.ok ? "charged" : "blocked",
      p.amount,
      p.reason,
      p.winnerId,
      p.probabilityBest.toFixed(4),
      p.impressions,
      p.errorCode ?? "",
      p.cardLast4 ?? "",
      p.transactionId ?? "",
      p.mandateId ?? "",
    ]),
  );
}

function auditRows(state: State): string {
  return rows(
    ["at", "kind", "detail"],
    state.audit.map((a) => [a.at, a.kind, a.detail]),
  );
}

function researchRows(state: State): string {
  const research = state.research;
  const body: unknown[][] = [];
  if (research) {
    body.push(["buyer_profile", research.buyerProfile, ""]);
    body.push(["price_positioning", research.pricePositioning, ""]);
    research.competitorAngles.forEach((angle) => body.push(["competitor_angle", angle, ""]));
    research.sources.forEach((source) => body.push(["source", source.title, source.url]));
  }
  return rows(["field", "value", "url"], body);
}

function productRows(state: State): string {
  const product = state.product;
  return rows(
    ["name", "price", "description"],
    product ? [[product.name, product.price, product.description]] : [],
  );
}

function rowCount(state: State, section: Section): number {
  if (section === "creatives") return state.creatives.length;
  if (section === "purchases") return state.purchases.length;
  if (section === "audit") return state.audit.length;
  if (section === "research") {
    const research = state.research;
    if (!research) return 0;
    return 2 + research.competitorAngles.length + research.sources.length;
  }
  return state.creatives.length + state.purchases.length + state.audit.length;
}

function csvFor(state: State, section: Section): string {
  if (section === "creatives") return creativeRows(state);
  if (section === "purchases") return purchaseRows(state);
  if (section === "audit") return auditRows(state);
  if (section === "research") return researchRows(state);

  return [
    "# banditd run export",
    `# exported ${new Date().toISOString()}`,
    `# ${DISCLOSURE}`,
    "",
    "# product",
    productRows(state),
    "",
    "# research",
    researchRows(state),
    "",
    "# creatives",
    creativeRows(state),
    "",
    "# purchases",
    purchaseRows(state),
    "",
    "# audit",
    auditRows(state),
  ].join("\r\n");
}

function jsonFor(state: State) {
  const rendered = renderedIds(state);
  const impressions = state.creatives.reduce((sum, c) => sum + c.arm.impressions, 0);
  const clicks = state.creatives.reduce((sum, c) => sum + c.arm.clicks, 0);
  const charged = state.purchases
    .filter((p) => p.ok)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  return {
    generator: "banditd",
    exportedAt: new Date().toISOString(),
    disclosure: DISCLOSURE,
    product: state.product,
    research: state.research,
    mandateId: state.mandateId,
    creatives: state.creatives.map((c) => ({
      id: c.id,
      generation: c.generation,
      parentId: c.parentId,
      angle: c.angle,
      headline: c.headline,
      body: c.body,
      targetEmotion: c.targetEmotion,
      imagePrompt: c.imagePrompt,
      hasImage: rendered.has(c.id),
      performance: {
        simulated: true,
        impressions: c.arm.impressions,
        clicks: c.arm.clicks,
        ctr: Number(rate(c.arm.impressions, c.arm.clicks).toFixed(4)),
      },
    })),
    purchases: state.purchases,
    audit: state.audit,
    totals: {
      creatives: state.creatives.length,
      generations: new Set(state.creatives.map((c) => c.generation)).size,
      impressionsSimulated: impressions,
      clicksSimulated: clicks,
      ctrSimulated: Number(rate(impressions, clicks).toFixed(4)),
      chargedUsd: Number(charged.toFixed(2)),
      chargesOk: state.purchases.filter((p) => p.ok).length,
      chargesBlocked: state.purchases.filter((p) => !p.ok).length,
    },
  };
}

export async function POST(req: Request) {
  try {
    const client = await guard(req, "read");
    const body = await readJson(req, ExportInput);
    const { state } = await readRun(body.runId, client);

    if (!state.product && state.creatives.length === 0 && state.purchases.length === 0) {
      throw new HttpFailure(
        "EMPTY_RUN",
        400,
        "the run is empty: submit a product and generate creatives before exporting.",
      );
    }

    const format: Format = body.format ?? "json";
    const section: Section = body.section ?? "all";

    const name = `banditd-${slug(state.product?.name)}-${section}-${stamp()}.${format}`;
    const payload =
      format === "csv" ? csvFor(state, section) : `${JSON.stringify(jsonFor(state), null, 2)}\n`;

    return new NextResponse(payload, {
      status: 200,
      headers: {
        "Content-Type":
          format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Banditd-Rows": String(rowCount(state, section)),
      },
    });
  } catch (err) {
    return failure(err);
  }
}
