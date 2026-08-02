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

export function strength(value: number): string {
  if (!Number.isFinite(value)) return "off the scale";
  if (value >= 1000) {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
      value,
    );
  }
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(2);
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

const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
const BULLET = /^[ \t]{0,3}[*+][ \t]+/gm;
const BOLD = /(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g;
const ITALIC = /(?<![\w*_])([*_])(\S(?:[^*_\n]*?\S)?)\1(?![\w*_])/g;
const CODE = /`{1,3}([^`\n]+)`{1,3}/g;
const STRAY = /\*{2,}/g;
const RUN = /[ \t]{2,}/g;

export function plain(value: string | null | undefined): string {
  if (!value) return "";
  let out = String(value).replace(HEADING, "").replace(BULLET, "");
  for (let pass = 0; pass < 3; pass += 1) out = out.replace(BOLD, "$2");
  out = out.replace(ITALIC, "$2").replace(CODE, "$1").replace(STRAY, "");
  return out.replace(RUN, " ").trim();
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
    citations.push({ label: plain(label), url });
    return `@@CITE${citations.length - 1}@@`;
  });
  if (!citations.length) return { text: plain(marked), citations };

  const text = plain(
    marked
      .replace(GROUP, (_match, group: string) => group.replace(/[\s,;]+/g, ""))
      .replace(LOOSE, ""),
  );

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
