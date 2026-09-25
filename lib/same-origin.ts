// Cross-site request check. This is CSRF protection, not authentication: a
// script outside a browser can write any Origin it likes. What stops such a
// caller from spending is lib/access.ts (session, per-client limits and the
// daily ceiling), not this file.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const withScheme = raw.includes("://") ? raw : `https://${raw}`;
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origins this deployment answers for. APP_URL names a custom domain;
 * Vercel fills in the production alias, the deployment URL and the branch URL.
 * Nothing else is implied, and localhost is only trusted outside production.
 */
export function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const raw of [
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ]) {
    const origin = originOf(raw);
    if (origin) origins.add(origin);
  }
  return origins;
}

function trusted(origin: string, allowed: Set<string>): boolean {
  if (allowed.has(origin)) return true;
  if (isProduction()) return false;
  return LOCAL_HOSTS.has(new URL(origin).hostname);
}

export function fromOurPage(req: Request): boolean {
  const allowed = allowedOrigins();
  const origin = req.headers.get("origin");
  if (origin) {
    const parsed = originOf(origin);
    return parsed !== null && trusted(parsed, allowed);
  }
  // No Origin header: browsers always send one on a POST fetch, so this is a
  // tool like curl. Fall back to the Referer, and outside production let a
  // header-less local call through so the scripts in the README keep working.
  const referer = originOf(req.headers.get("referer") ?? undefined);
  if (referer) return trusted(referer, allowed);
  return !isProduction();
}

export const OFF_PAGE_CODE = "NOT_FROM_THE_APP";

export const OFF_PAGE_MESSAGE =
  "This endpoint only answers requests sent by the banditd page itself, and this one came from another site or from no page at all. Nothing was spent. If you host banditd on your own domain, set APP_URL to that address.";
