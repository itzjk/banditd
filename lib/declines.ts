export type DeclineFamily = "guardrail" | "provider" | "request" | "unknown";

export const PROVIDER_UNREACHABLE = "PROVIDER_UNREACHABLE";

const GUARDRAIL = new Set([
  "THRESHOLD_EXCEEDED",
  "MANDATE_MERCHANT_NOT_ALLOWED",
  "MANDATE_NOT_ACTIVE",
  "TRIES_EXHAUSTED",
  "CYCLE_ALREADY_CHARGED",
  "NO_MANDATE_AVAILABLE",
  "MERCHANT_MANDATE_MISSING",
]);

const PROVIDER = new Set([
  "FETCH_AGENTIC_CREDS_ERROR",
  "NO_TOKEN",
  "VISA_CONFIRMATION_FAILED",
  "FIDO_START_FAILED",
  "ADDCARD_PROCESSING_ERROR",
  "PRAVA_TIMEOUT",
  PROVIDER_UNREACHABLE,
]);

function statusOf(code: string): number | null {
  if (!code.startsWith("HTTP_")) return null;
  const n = Number(code.slice(5));
  return Number.isFinite(n) ? n : null;
}

export function declineFamily(code: string | null | undefined): DeclineFamily {
  if (!code) return "unknown";
  const upper = code.toUpperCase();
  if (GUARDRAIL.has(upper)) return "guardrail";
  if (PROVIDER.has(upper)) return "provider";
  const status = statusOf(upper);
  if (status !== null) {
    if (status >= 500 || status === 408 || status === 429) return "provider";
    if (status >= 400) return "request";
  }
  return "unknown";
}
