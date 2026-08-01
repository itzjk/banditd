import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Arm } from "./bandit.ts";

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "state.json");

export interface Product {
  name: string;
  price: string;
  description: string;
}

export interface Research {
  buyerProfile: string;
  competitorAngles: string[];
  pricePositioning: string;
  sources: { title: string; url: string }[];
}

export type CreativeAngle = "price" | "ritual" | "gift" | "quality";

export interface Creative {
  id: string;
  generation: number;
  parentId: string | null;
  angle: CreativeAngle;
  headline: string;
  body: string;
  imagePrompt: string;
  targetEmotion: string;
  imageData: string | null;
  arm: Arm;
}

export interface PurchaseEvent {
  id: string;
  at: string;
  amount: string;
  reason: string;
  winnerId: string;
  probabilityBest: number;
  impressions: number;
  ok: boolean;
  errorCode: string | null;
  cardLast4: string | null;
  transactionId: string | null;
}

export interface AuditEntry {
  at: string;
  kind: string;
  detail: string;
}

export interface State {
  product: Product | null;
  research: Research | null;
  creatives: Creative[];
  purchases: PurchaseEvent[];
  audit: AuditEntry[];
  mandateId: string | null;
  simulatedImpressions: number;
}

function empty(): State {
  return {
    product: null,
    research: null,
    creatives: [],
    purchases: [],
    audit: [],
    mandateId: process.env.PRAVA_MANDATE_ID ?? null,
    simulatedImpressions: 0,
  };
}

let state: State | null = null;

function load(): State {
  if (state) return state;
  if (existsSync(DATA_FILE)) {
    try {
      state = JSON.parse(readFileSync(DATA_FILE, "utf8")) as State;
      return state;
    } catch {
      state = empty();
      return state;
    }
  }
  state = empty();
  return state;
}

function persist() {
  if (!state) return;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

export function getState(): State {
  return load();
}

export function update(fn: (s: State) => void): State {
  const s = load();
  fn(s);
  persist();
  return s;
}

export function audit(kind: string, detail: string) {
  update((s) => {
    s.audit.unshift({ at: new Date().toISOString(), kind, detail });
    if (s.audit.length > 200) s.audit.length = 200;
  });
}

export function reset() {
  state = empty();
  persist();
}
