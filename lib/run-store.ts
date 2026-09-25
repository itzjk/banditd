import { randomBytes } from "node:crypto";
import { z } from "zod";
import { HttpFailure } from "./http.ts";
import { kv } from "./kv.ts";
import { coerceState, RUN_ID_SHAPE } from "./state-schema.ts";
import type { State } from "./state-schema.ts";
import { requireSession } from "./access.ts";
import type { Client } from "./access.ts";

/**
 * The server's copy of every run, the only copy anything is decided on.
 * Credits, click counts, cohorts and the mandate on file are written here by
 * the routes and nowhere else; the browser receives a view and sends back a
 * run id.
 */
export interface RunRecord {
  owner: string;
  version: number;
  state: State;
  /** Response ids the chat model handed this run, the only ones it may resume. */
  chat: string[];
  /** Variant shots already rendered for this run, each is drawn once. */
  shots: string[];
  /** A charge is in flight until this epoch millisecond. */
  purchaseUntil: number | null;
}

const MAX_CHAT_IDS = 20;
const MAX_WRITE_ATTEMPTS = 6;

function ttlSeconds(): number {
  const n = Number(process.env.RUN_TTL_SECONDS ?? 7 * 86400);
  return Number.isInteger(n) && n > 0 ? n : 7 * 86400;
}

const Envelope = z.object({
  owner: z.string().regex(/^[0-9a-f]{32}$/),
  state: z.unknown(),
  chat: z.array(z.string()).max(MAX_CHAT_IDS),
  shots: z.array(z.string()).max(32),
  purchaseUntil: z.number().nullable(),
});

const key = (runId: string) => `run:${runId}`;

export function newRunId(): string {
  return `run_${randomBytes(16).toString("hex")}`;
}

function decode(runId: string, stored: { value: string; version: number }): RunRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(stored.value);
  } catch {
    raw = null;
  }
  const envelope = Envelope.safeParse(raw);
  const state = envelope.success ? coerceState(envelope.data.state) : null;
  if (!envelope.success || !state || state.runId !== runId) {
    throw new HttpFailure(
      "RUN_UNREADABLE",
      500,
      `Run ${runId} is stored in a shape the server cannot read, so nothing was done with it. Start a new run.`,
    );
  }
  return {
    owner: envelope.data.owner,
    version: stored.version,
    state: { ...state, version: stored.version },
    chat: envelope.data.chat,
    shots: envelope.data.shots,
    purchaseUntil: envelope.data.purchaseUntil,
  };
}

function encode(record: RunRecord, version: number): string {
  return JSON.stringify({
    owner: record.owner,
    state: {
      ...record.state,
      version,
      creatives: record.state.creatives.map((c) => ({ ...c, imageData: null })),
    },
    chat: record.chat.slice(-MAX_CHAT_IDS),
    shots: record.shots,
    purchaseUntil: record.purchaseUntil,
  });
}

export async function createRun(owner: string, build: (runId: string) => State): Promise<RunRecord> {
  const runId = newRunId();
  const record: RunRecord = {
    owner,
    version: 1,
    state: build(runId),
    chat: [],
    shots: [],
    purchaseUntil: null,
  };
  const written = await kv().swap(key(runId), 0, encode(record, 1), ttlSeconds());
  if (!written) throw new HttpFailure("RUN_BUSY", 409, "A run id collided. Try again.");
  return { ...record, state: { ...record.state, version: 1 } };
}

export async function readRun(runId: string, client: Client): Promise<RunRecord> {
  const sid = requireSession(client);
  if (!RUN_ID_SHAPE.test(runId)) {
    throw new HttpFailure("BAD_REQUEST", 400, "runId is not a run id this server issues.");
  }
  const stored = await kv().read(key(runId));
  if (!stored) {
    throw new HttpFailure(
      "RUN_NOT_FOUND",
      404,
      "The server has no run with this id: it expired or never existed. Start a new run from the home page.",
    );
  }
  const record = decode(runId, stored);
  if (record.owner !== sid) {
    throw new HttpFailure(
      "RUN_NOT_YOURS",
      403,
      "This run belongs to another browser session. Only the session that started a run can read or change it.",
    );
  }
  return record;
}

/**
 * Applies `change` to the latest copy of a run and writes it back only if no
 * other request wrote in between; otherwise it re-reads and applies it again.
 * That is what makes a credit debit atomic. `change` must not call the
 * network: it can run more than once.
 */
export async function updateRun<T>(
  runId: string,
  client: Client,
  change: (record: RunRecord) => T,
): Promise<{ record: RunRecord; result: T }> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const current = await readRun(runId, client);
    const draft: RunRecord = structuredClone(current);
    const result = change(draft);
    const version = current.version + 1;
    if (await kv().swap(key(runId), current.version, encode(draft, version), ttlSeconds())) {
      return { record: { ...draft, version, state: { ...draft.state, version } }, result };
    }
  }
  throw new HttpFailure(
    "RUN_BUSY",
    409,
    "Too many changes hit this run at once, so this one was not applied. Nothing was spent. Try again.",
    { retryAfterSeconds: 1 },
  );
}

export function rememberChat(record: RunRecord, responseId: string) {
  if (!record.chat.includes(responseId)) record.chat.push(responseId);
  if (record.chat.length > MAX_CHAT_IDS) record.chat.splice(0, record.chat.length - MAX_CHAT_IDS);
}
