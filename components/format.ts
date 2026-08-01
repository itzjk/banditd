export function money(value: string | number | null | undefined): string {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export function toNumber(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(digits)}%`;
}

export function ctr(impressions: number, clicks: number): number {
  if (!impressions) return 0;
  return clicks / impressions;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function shortId(id: string | null | undefined, keep = 6): string {
  if (!id) return "";
  return id.length <= keep + 3 ? id : `${id.slice(0, keep)}...${id.slice(-4)}`;
}

export interface Citation {
  label: string;
  url: string;
}

export type CitedSegment =
  | { kind: "text"; value: string }
  | { kind: "cite"; index: number };

const LINK = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,3000})\)/g;
const GROUP = /[ \t]*\(\s*((?:@@CITE\d+@@[\s,;]*)+)\)/g;
const LOOSE = /[ \t]+(?=@@CITE\d+@@)/g;
const SPLIT = /@@CITE(\d+)@@/;
const SENTENCE = /(?<=[.!?](?:@@CITE\d+@@)*)\s+/;

export function extractCitations(value: string): { text: string; citations: Citation[] } {
  const citations: Citation[] = [];
  const marked = (value ?? "").replace(LINK, (_match, label: string, url: string) => {
    citations.push({ label: label.trim(), url });
    return `@@CITE${citations.length - 1}@@`;
  });
  if (!citations.length) return { text: marked, citations };

  const text = marked
    .replace(GROUP, (_match, group: string) => group.replace(/[\s,;]+/g, ""))
    .replace(LOOSE, "")
    .trim();

  return { text, citations };
}

export function citedSegments(value: string): CitedSegment[] {
  const out: CitedSegment[] = [];
  value.split(SPLIT).forEach((part, i) => {
    if (i % 2 === 1) {
      out.push({ kind: "cite", index: Number(part) });
      return;
    }
    if (part) out.push({ kind: "text", value: part });
  });
  return out;
}

export function sentencesOf(value: string): string[] {
  return value
    .split(SENTENCE)
    .map((s) => s.trim())
    .filter(Boolean);
}
