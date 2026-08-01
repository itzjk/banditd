import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { emptyState, coerceState, MAX_AUDIT, MAX_ROUNDS } from "./state-schema.ts";
import type { State, Session, RoundArm } from "./state-schema.ts";

export * from "./state-schema.ts";

const WRITABLE_ROOT = process.env.VERCEL ? "/tmp" : process.cwd();
const DATA_DIR = join(WRITABLE_ROOT, "data");
const DATA_FILE = join(DATA_DIR, "state.json");
const DISK = !process.env.VERCEL;

let state: State | null = null;

function load(): State {
  if (state) return state;
  if (DISK && existsSync(DATA_FILE)) {
    try {
      state = coerceState(JSON.parse(readFileSync(DATA_FILE, "utf8"))) ?? emptyState();
      return state;
    } catch {
      state = emptyState();
      return state;
    }
  }
  state = emptyState();
  return state;
}

function persist() {
  if (!DISK || !state) return;
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch {
    return;
  }
}

export function getState(): State {
  return load();
}

export function openSession(incoming: unknown): Session {
  const carried = coerceState(incoming);
  if (carried) return { state: carried, detached: true };
  return { state: load(), detached: false };
}

export function commit(session: Session): State {
  if (!session.detached) {
    state = session.state;
    persist();
  }
  return session.state;
}

export function logAudit(target: State, kind: string, detail: string) {
  target.audit.unshift({ at: new Date().toISOString(), kind, detail });
  if (target.audit.length > MAX_AUDIT) target.audit.length = MAX_AUDIT;
}

export function logRound(
  target: State,
  generation: number,
  served: number,
  arms: RoundArm[],
) {
  target.rounds.push({ at: new Date().toISOString(), generation, served, arms });
  const excess = target.rounds.length - MAX_ROUNDS;
  if (excess > 0) target.rounds.splice(0, excess);
}
