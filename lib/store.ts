import { MAX_AUDIT, MAX_ROUNDS } from "./state-schema.ts";
import type { State, RoundArm, CreditKind } from "./state-schema.ts";

export * from "./state-schema.ts";

// Pure edits on a run. They never persist anything: a route applies them inside
// `updateRun` (lib/run-store.ts), which writes the run back atomically.

export function logAudit(target: State, kind: string, detail: string) {
  target.audit.unshift({ at: new Date().toISOString(), kind, detail });
  if (target.audit.length > MAX_AUDIT) target.audit.length = MAX_AUDIT;
}

export function logCredit(target: State, kind: CreditKind, amount: number, ref: string) {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error(`a credit movement has to be a whole, non zero number of credits, got ${amount}`);
  }
  if (target.credits.balance + amount < 0) {
    throw new Error(
      `a ${kind} of ${amount} would take the balance of ${target.credits.balance} below zero`,
    );
  }
  target.credits.entries.unshift({ at: new Date().toISOString(), kind, amount, ref });
  if (target.credits.entries.length > MAX_AUDIT) target.credits.entries.length = MAX_AUDIT;
  target.credits.balance += amount;
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
