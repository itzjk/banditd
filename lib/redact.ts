/**
 * Upstream error text (OpenAI, Prava, a merchant) is written for the account
 * owner, not for whoever is using the page: a rejected key comes back with its
 * last four characters, a quota error names the organization. Anything that
 * crosses to a browser goes through safeError; the untouched text goes to the
 * server log only, through logUpstream.
 */
const SECRET_SHAPES: RegExp[] = [
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9*_.-]{2,}/gi, // sk_test_..., sk-proj-****abcd
  /\*{3,}[A-Za-z0-9_-]*/g, // any masked key tail
  /\b(?:org|proj|user|acct)[-_][A-Za-z0-9]{4,}/gi, // organization, project, user ids
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, // email addresses
];

export function safeError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return SECRET_SHAPES.reduce((text, shape) => text.replace(shape, "[redacted]"), raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function logUpstream(source: string, detail: unknown) {
  console.error(`[upstream ${source}]`, detail);
}
