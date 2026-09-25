import { NextResponse } from "next/server";
import type { z } from "zod";
import { StepFailure, failureBody } from "./openai.ts";

/**
 * A refusal the route means to send. `code` is the stable identifier clients
 * branch on, `message` is prose for a person and can change freely.
 */
export class HttpFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly extra: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    message: string,
    options: { retryAfterSeconds?: number | null; extra?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "HttpFailure";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.extra = options.extra ?? {};
  }
}

/** Turns anything a route throws into one response shape: `{ error, code, ... }`. */
export function failure(err: unknown): NextResponse {
  if (err instanceof HttpFailure) {
    const headers: Record<string, string> = {};
    if (err.retryAfterSeconds !== null) headers["retry-after"] = String(err.retryAfterSeconds);
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        ...(err.retryAfterSeconds !== null ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
        ...err.extra,
      },
      { status: err.status, headers },
    );
  }
  if (err instanceof StepFailure) {
    const { status, body } = failureBody(err);
    return NextResponse.json(body, { status });
  }
  console.error("unhandled route failure", err);
  return NextResponse.json(
    {
      error:
        "The server hit an error it has no answer for. Nothing was charged by the part that failed; the audit log says what did complete.",
      code: "INTERNAL",
    },
    { status: 500 },
  );
}

const MAX_BODY_BYTES = 100_000;

/**
 * Reads and validates a JSON body against its contract. A body that is
 * missing, not JSON, too large or not in the contract's shape is refused with
 * a 400 that names the field, never read as an empty object.
 */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new HttpFailure(
      "BODY_TOO_LARGE",
      413,
      `The request body is ${raw.length} bytes and this endpoint reads at most ${MAX_BODY_BYTES}.`,
    );
  }
  if (!raw.trim()) {
    throw new HttpFailure("BAD_REQUEST", 400, "The request has no body. Send a JSON object.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpFailure("BAD_JSON", 400, "The request body is not valid JSON.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(body)",
      message: issue.message,
    }));
    const first = issues[0];
    throw new HttpFailure(
      "BAD_REQUEST",
      400,
      `The request does not match what this endpoint accepts: ${first.path}: ${first.message}.`,
      { extra: { issues } },
    );
  }
  return result.data;
}
