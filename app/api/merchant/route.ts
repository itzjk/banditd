import { NextResponse } from "next/server";
import {
  AGENT_PROFILE_PATH,
  CATALOG_SEARCH,
  greetMerchant,
  type CatalogReason,
  type Handshake,
} from "@/lib/ucp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_ORIGIN = "https://banditd.vercel.app";

const NEVER_SENT = new Set<CatalogReason>([
  "no_endpoint",
  "capability_absent",
  "version_unsupported",
  "version_not_declared",
  "version_profile_error",
]);

interface Body {
  domain?: unknown;
  query?: unknown;
  country?: unknown;
  profile?: unknown;
  version?: unknown;
}

function publicOrigin(req: Request): string {
  const configured = process.env.BANDITD_PUBLIC_ORIGIN;
  if (configured?.startsWith("https://")) return configured.replace(/\/+$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";

  if (!host || proto !== "https" || host.startsWith("localhost") || host.startsWith("127.")) {
    return FALLBACK_ORIGIN;
  }

  return `https://${host}`;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function summarize(shake: Handshake): string {
  if (!shake.discovery.ok) return shake.discovery.detail;

  const { profile } = shake.discovery;
  const chosen = shake.negotiation?.chosen;
  const head = chosen
    ? `${profile.domain} offers ${shake.negotiation?.offered.join(" and ")} and this run settled on ${chosen}${
        shake.negotiation?.pinned ? ", pinned by hand" : ""
      }.`
    : `${profile.domain} speaks UCP ${profile.version ?? "of an undeclared version"}.`;

  const declined = shake.capabilities.filter((cap) => cap.verdict === "declined").length;
  const tail = declined
    ? ` ${declined} capabilit${declined === 1 ? "y it offers was" : "ies it offers were"} left unused on purpose.`
    : "";

  if (!shake.catalog) return head;
  if (shake.catalog.ok) {
    return `${head} The store advertises ${CATALOG_SEARCH}, so the search ran and answered with ${
      shake.catalog.products.length
    } priced product${shake.catalog.products.length === 1 ? "" : "s"}.${tail}`;
  }

  const lead = NEVER_SENT.has(shake.catalog.reason)
    ? "No search request was sent"
    : "The search request went out and did not complete";

  return `${head} ${lead}: ${shake.catalog.detail}${tail}`;
}

async function run(req: Request, input: Body) {
  const domain = text(input.domain, 253);

  if (!domain) {
    return NextResponse.json(
      { ok: false, error: "NO_DOMAIN", message: "Send a domain, for example allbirds.com" },
      { status: 400 },
    );
  }

  const origin = publicOrigin(req);
  const profileUrl = text(input.profile, 300) || `${origin}${AGENT_PROFILE_PATH}`;

  let shake: Handshake;
  try {
    shake = await greetMerchant({
      domain,
      profileUrl,
      query: text(input.query, 120),
      country: text(input.country, 2).toUpperCase() || undefined,
      version: text(input.version, 10) || undefined,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "HANDSHAKE_FAILED",
        domain,
        profileUrl,
        message: error instanceof Error ? error.message : "The handshake could not be attempted.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: shake.spokeUcp,
      domain: shake.domain,
      profileUrl: shake.profileUrl,
      agentVersion: shake.agentVersion,
      summary: summarize(shake),
      purchased: false,
      ms: shake.ms,
      discovery: shake.discovery,
      negotiation: shake.negotiation,
      capabilities: shake.capabilities,
      payment: shake.payment,
      catalog: shake.catalog,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  return run(req, {
    domain: params.get("domain"),
    query: params.get("query"),
    country: params.get("country"),
    profile: params.get("profile"),
    version: params.get("version"),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  return run(req, body);
}
