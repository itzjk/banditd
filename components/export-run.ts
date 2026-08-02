import type { Creative, PurchaseEvent, State } from "@/lib/store";
import { ctr, money, pct, plain, strength } from "./format";
import { declineFamily } from "@/lib/declines";

export interface RunEvaluation {
  candidateId?: string | null;
  candidateIndex?: number;
  probabilityBest?: number;
  sufficientEvidence?: boolean;
  totalImpressions?: number;
  expectedLoss?: number;
  eValue?: number;
  posteriorMean?: number;
  thresholdMet?: boolean;
  minImpressionsMet?: boolean;
  effectSizeOk?: boolean;
  anytimeValid?: boolean;
}

export interface RunExportInput {
  state: State;
  images: Record<string, string>;
  evaluation: RunEvaluation | null;
}

interface GateLine {
  name: string;
  met: boolean;
  current: string;
  required: string;
  meaning: string;
}

export const SIMULATED_NOTE =
  "Impressions, clicks and click through rate in this file come from the simulated traffic model inside banditd. They were not measured on a live ad platform.";

export const SANDBOX_NOTE =
  "Payments ran against the Prava sandbox. Card digits, transaction ids and mandate ids are sandbox records, so no real money moved.";

const THRESHOLD = 0.95;
const MIN_IMPRESSIONS = 200;
const EFFECT_TOLERANCE = 0.01;
const ALPHA = 0.05;

export function slug(value: string | null | undefined): string {
  const cleaned = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || "run";
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function extensionFor(dataUrl: string): string {
  const found = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl);
  const kind = (found?.[1] ?? "png").toLowerCase();
  if (kind === "jpeg" || kind === "jpg") return "jpg";
  if (kind === "svg+xml") return "svg";
  if (kind === "webp") return "webp";
  if (kind === "gif") return "gif";
  return "png";
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const found = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!found) return null;
  const type = found[1] ?? "application/octet-stream";
  const body = found[3];
  if (!found[2]) {
    try {
      return new Blob([decodeURIComponent(body)], { type });
    } catch {
      return null;
    }
  }
  try {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function saveText(text: string, name: string, type = "text/plain;charset=utf-8") {
  saveBlob(new Blob([text], { type }), name);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function adCopyText(
  creative: Creative,
  productName: string | null | undefined,
  probabilityBest: number | null | undefined,
): string {
  const rate = ctr(creative.arm.impressions, creative.arm.clicks);
  const lines = [
    "banditd winning ad",
    productName ? `Product: ${productName}` : null,
    "",
    "HEADLINE",
    plain(creative.headline),
    "",
    "BODY",
    plain(creative.body),
    "",
    `Angle: ${creative.angle}`,
    `Generation: ${creative.generation}`,
    `Ad id: ${creative.id}`,
    typeof probabilityBest === "number"
      ? `Probability it is the best of the four: ${pct(probabilityBest)}`
      : null,
    `Simulated performance: ${creative.arm.impressions.toLocaleString()} impressions, ${creative.arm.clicks.toLocaleString()} clicks, ${pct(rate, 2)} click through rate`,
    "",
    SIMULATED_NOTE,
    SANDBOX_NOTE,
  ];
  return `${lines.filter((line) => line !== null).join("\n")}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeText(value: string | null | undefined): string {
  return escapeHtml(plain(value));
}

function readable(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function loss(value: number): string {
  if (!Number.isFinite(value)) return "not measured";
  return pct(value, 3);
}

export function gatesOf(evaluation: RunEvaluation | null, candidateImpressions: number): GateLine[] {
  if (!evaluation) return [];
  const probabilityBest = evaluation.probabilityBest ?? 0;
  const expectedLoss = evaluation.expectedLoss ?? Number.POSITIVE_INFINITY;
  const posteriorMean = evaluation.posteriorMean ?? 0;
  const eValue = evaluation.eValue ?? 0;
  const evidenceTarget = 1 / ALPHA;
  const lossBudget = EFFECT_TOLERANCE * (posteriorMean > 0 ? posteriorMean : 1);

  return [
    {
      name: "Enough traffic",
      met: evaluation.minImpressionsMet ?? candidateImpressions >= MIN_IMPRESSIONS,
      current: `${Math.round(candidateImpressions).toLocaleString()} on the candidate`,
      required: `${MIN_IMPRESSIONS.toLocaleString()} needed`,
      meaning: "Without enough data, any winner is just noise.",
    },
    {
      name: "One ad clearly ahead",
      met: evaluation.thresholdMet ?? probabilityBest > THRESHOLD,
      current: `${pct(probabilityBest)} sure it is best`,
      required: `${pct(THRESHOLD)} needed`,
      meaning: "How sure the agent is that this ad is truly the best one.",
    },
    {
      name: "The gap is worth money",
      met: evaluation.effectSizeOk ?? expectedLoss < lossBudget,
      current: `${loss(expectedLoss)} expected loss`,
      required: `under ${loss(lossBudget)}`,
      meaning: "If the difference is tiny, switching is not worth spending on.",
    },
    {
      name: "Holds up to repeated looks",
      met: evaluation.anytimeValid ?? eValue >= evidenceTarget,
      current: `${strength(eValue)} evidence strength`,
      required: `${strength(evidenceTarget)} needed`,
      meaning: "Checking the data over and over inflates false winners. This gate blocks that.",
    },
  ];
}

function imageBlock(creative: Creative, images: Record<string, string>): string {
  const src = creative.imageData ?? images[creative.id] ?? null;
  if (!src) return '<div class="shot empty">No image returned</div>';
  return `<img class="shot" src="${escapeHtml(src)}" alt="${safeText(creative.headline)}">`;
}

function adBlock(
  creative: Creative,
  images: Record<string, string>,
  winner: boolean,
  probabilityBest: number | null,
): string {
  const rate = ctr(creative.arm.impressions, creative.arm.clicks);
  return `<article class="ad${winner ? " won" : ""}">
      ${winner ? '<div class="ribbon">Winning ad</div>' : ""}
      ${imageBlock(creative, images)}
      <div class="pad">
        <div class="tags"><span class="tag">${safeText(creative.angle)}</span><span class="tag">Gen ${creative.generation}</span></div>
        <h3>${safeText(creative.headline)}</h3>
        <p>${safeText(creative.body)}</p>
        <dl class="stats">
          <div><dt>Impressions</dt><dd>${creative.arm.impressions.toLocaleString()}</dd></div>
          <div><dt>Clicks</dt><dd>${creative.arm.clicks.toLocaleString()}</dd></div>
          <div><dt>Click rate</dt><dd>${pct(rate, 2)}</dd></div>
          ${
            winner && typeof probabilityBest === "number"
              ? `<div><dt>Probability best</dt><dd>${pct(probabilityBest)}</dd></div>`
              : ""
          }
        </dl>
        <p class="muted">Ad id ${escapeHtml(creative.id)}</p>
      </div>
    </article>`;
}

function outcomeLabel(p: PurchaseEvent): string {
  if (p.ok) return "Charged";
  const family = declineFamily(p.errorCode);
  if (family === "guardrail") return "Blocked by the mandate";
  if (family === "request") return "Rejected before the mandate";
  if (family === "provider") return "Not processed by the provider";
  return "Not completed";
}

function purchaseRows(purchases: PurchaseEvent[]): string {
  if (purchases.length === 0) {
    return '<tr><td colspan="6" class="muted">The agent never reached for the card in this run.</td></tr>';
  }
  return purchases
    .map(
      (p) => `<tr>
        <td>${escapeHtml(readable(p.at))}</td>
        <td class="${p.ok ? "ok" : "no"}">${escapeHtml(outcomeLabel(p))}</td>
        <td class="num">$${escapeHtml(money(p.amount))}</td>
        <td>${escapeHtml(p.transactionId ?? p.errorCode ?? "")}</td>
        <td>${p.cardLast4 ? `card ${escapeHtml(p.cardLast4)}` : ""}</td>
        <td>${safeText(p.reason)}</td>
      </tr>`,
    )
    .join("");
}

export function runExportHtml({ state, images, evaluation }: RunExportInput): string {
  const creatives = state.creatives;
  const generation = creatives.length ? Math.max(...creatives.map((c) => c.generation)) : 0;
  const cohort = creatives.filter((c) => c.generation === generation);
  const winnerId = evaluation?.candidateId ?? null;
  const winner =
    (winnerId ? cohort.find((c) => c.id === winnerId) : null) ??
    (typeof evaluation?.candidateIndex === "number" ? cohort[evaluation.candidateIndex] : null) ??
    null;
  const probabilityBest = evaluation?.probabilityBest ?? null;
  const gates = gatesOf(evaluation, winner?.arm.impressions ?? 0);
  const cleared = gates.filter((g) => g.met).length;
  const impressions = cohort.reduce((sum, c) => sum + c.arm.impressions, 0);
  const clicks = cohort.reduce((sum, c) => sum + c.arm.clicks, 0);
  const charged = state.purchases
    .filter((p) => p.ok)
    .reduce((sum, p) => sum + Number(money(p.amount)), 0);
  const insights = state.insights;
  const product = state.product;
  const title = `banditd run, ${product?.name ?? "untitled product"}`;

  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #09090b; color: #e4e4e7; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.55; }
.wrap { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; line-height: 1.25; margin: 0 0 6px; color: #fff; letter-spacing: -0.01em; }
h2 { font-size: 15px; margin: 32px 0 12px; color: #fff; text-transform: uppercase; letter-spacing: 0.14em; }
h3 { font-size: 16px; margin: 0 0 6px; color: #fff; }
p { margin: 0 0 8px; }
a { color: #a1a1aa; }
.eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #a1a1aa; margin: 0 0 8px; }
.muted { color: #a1a1aa; font-size: 12px; }
.note { border: 1px solid rgba(250, 204, 21, 0.35); background: rgba(250, 204, 21, 0.08); border-radius: 12px; padding: 12px 14px; margin: 16px 0 0; font-size: 13px; color: #fde68a; }
.note strong { color: #fef3c7; display: block; margin-bottom: 4px; }
.grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
.tiles { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.tile { border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px 12px; }
.tile dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #a1a1aa; }
.tile dd { margin: 4px 0 0; font-size: 18px; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
.ad { border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; overflow: hidden; background: rgba(255,255,255,0.02); }
.ad.won { border-color: rgba(255,255,255,0.45); }
.ribbon { background: #fff; color: #09090b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; padding: 6px 12px; }
.shot { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: #18181b; }
.shot.empty { display: flex; align-items: center; justify-content: center; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #71717a; }
.pad { padding: 14px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.tag { border: 1px solid rgba(255,255,255,0.15); border-radius: 999px; padding: 2px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #d4d4d8; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 12px 0 8px; }
.stats > div { background: rgba(255,255,255,0.04); border-radius: 8px; padding: 6px 8px; }
.stats dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #a1a1aa; }
.stats dd { margin: 2px 0 0; font-size: 14px; font-weight: 600; color: #fafafa; font-variant-numeric: tabular-nums; }
.gate { border: 1px solid rgba(255,255,255,0.1); border-left-width: 3px; border-radius: 12px; padding: 10px 12px; }
.gate.pass { border-left-color: #34d399; }
.gate.wait { border-left-color: #fbbf24; }
.gate .badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
.gate.pass .badge { color: #6ee7b7; }
.gate.wait .badge { color: #fcd34d; }
.scroll { overflow-x: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; }
table { border-collapse: collapse; width: 100%; min-width: 560px; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); vertical-align: top; }
th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #a1a1aa; }
td.num { font-variant-numeric: tabular-nums; }
td.ok { color: #6ee7b7; }
td.no { color: #fca5a5; }
.copy { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 14px; background: rgba(255,255,255,0.02); }
.copy pre { margin: 8px 0 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #d4d4d8; }
footer { margin-top: 40px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px; font-size: 12px; color: #71717a; }
@media (min-width: 700px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  h1 { font-size: 28px; }
}
</style>
</head>
<body>
<div class="wrap">`;

  const header = `<p class="eyebrow">banditd run export</p>
<h1>${safeText(product?.name ?? "Untitled product")}</h1>
<p class="muted">${product?.price ? `Listed at ${escapeHtml(product.price)}. ` : ""}Generation ${generation}, ${cohort.length} ads tested. Exported ${escapeHtml(readable(new Date().toISOString()))}.</p>
${product?.description ? `<p>${safeText(product.description)}</p>` : ""}
<div class="note"><strong>Read this before you trust a number</strong>${escapeHtml(SIMULATED_NOTE)} ${escapeHtml(SANDBOX_NOTE)}</div>`;

  const totals = `<h2>The run at a glance</h2>
<dl class="tiles">
  <div class="tile"><dt>Simulated impressions</dt><dd>${impressions.toLocaleString()}</dd></div>
  <div class="tile"><dt>Simulated clicks</dt><dd>${clicks.toLocaleString()}</dd></div>
  <div class="tile"><dt>Simulated click rate</dt><dd>${pct(ctr(impressions, clicks), 2)}</dd></div>
  <div class="tile"><dt>Sandbox spend</dt><dd>$${escapeHtml(money(charged))}</dd></div>
</dl>`;

  const winnerBlock = winner
    ? `<h2>The ad that won</h2>
<div class="grid">${adBlock(winner, images, true, probabilityBest)}
<div class="copy">
  <h3>Paste ready copy</h3>
  <p class="muted">Headline and body exactly as the agent wrote them.</p>
  <pre>${escapeHtml(adCopyText(winner, product?.name, probabilityBest))}</pre>
</div></div>`
    : `<h2>The ad that won</h2>
<p class="muted">No candidate was picked in this run, so there is no winner to hand over yet.</p>`;

  const cohortBlock = `<h2>All ${cohort.length} ads in generation ${generation}</h2>
<div class="grid">${cohort.map((c) => adBlock(c, images, c.id === winner?.id, probabilityBest)).join("")}</div>`;

  const gatesBlock =
    gates.length > 0
      ? `<h2>The four gates, ${cleared} of ${gates.length} cleared</h2>
<p class="muted">All four clear before a cent moves. Every figure below is measured on simulated traffic.</p>
<div class="grid">${gates
          .map(
            (g) => `<div class="gate ${g.met ? "pass" : "wait"}">
    <span class="badge">${g.met ? "Cleared" : "Pending"}</span>
    <h3>${escapeHtml(g.name)}</h3>
    <p class="muted">${escapeHtml(g.current)}, ${escapeHtml(g.required)}.</p>
    <p class="muted">${escapeHtml(g.meaning)}</p>
  </div>`,
          )
          .join("")}</div>`
      : `<h2>The four gates</h2>
<p class="muted">The gates were never evaluated in this run, so there is no verdict to report.</p>`;

  const moneyBlock = `<h2>Money it moved</h2>
<p class="muted">${escapeHtml(SANDBOX_NOTE)} Mandate ${escapeHtml(state.mandateId ?? "not set")}.</p>
<div class="scroll"><table>
<thead><tr><th>When</th><th>Outcome</th><th>Amount</th><th>Receipt</th><th>Card</th><th>Why</th></tr></thead>
<tbody>${purchaseRows(state.purchases)}</tbody>
</table></div>`;

  const insightBlock = insights
    ? `<h2>What it recommends next</h2>
${insights.buyerLesson ? `<p>${safeText(insights.buyerLesson)}</p>` : ""}
${
  insights.competitorPlays.length > 0
    ? `<h3>Plays nobody has tested</h3><ul>${insights.competitorPlays
        .map((p) => `<li>${safeText(p.play)} <span class="muted">${safeText(p.why)}</span></li>`)
        .join("")}</ul>`
    : ""
}
${
  insights.nextTests.length > 0
    ? `<h3>Next tests</h3><ul>${insights.nextTests
        .map((t) => `<li>${safeText(t.idea)} <span class="muted">${safeText(t.why)}</span></li>`)
        .join("")}</ul>`
    : ""
}
${
  insights.estimates.length > 0
    ? `<h3>What the numbers can and cannot say</h3><ul>${insights.estimates
        .map(
          (e) =>
            `<li><strong>${safeText(e.label)}</strong> ${safeText(e.call)} <span class="muted">${safeText(e.basis)}</span></li>`,
        )
        .join("")}</ul>`
    : ""
}`
    : "";

  const foot = `<footer>
<p>Exported from banditd. ${escapeHtml(SIMULATED_NOTE)}</p>
<p>${escapeHtml(SANDBOX_NOTE)}</p>
</footer>
</div>
</body>
</html>
`;

  return [
    head,
    header,
    totals,
    winnerBlock,
    cohortBlock,
    gatesBlock,
    moneyBlock,
    insightBlock,
    foot,
  ].join("\n");
}

export function runFileName(state: State): string {
  return `banditd-${slug(state.product?.name)}-run-${stamp()}.html`;
}

export function winnerImageName(
  creative: Creative,
  productName: string | null | undefined,
  dataUrl: string,
): string {
  return `banditd-${slug(productName)}-winner-${creative.id.slice(0, 6)}.${extensionFor(dataUrl)}`;
}

export function winnerCopyName(creative: Creative, productName: string | null | undefined): string {
  return `banditd-${slug(productName)}-winner-${creative.id.slice(0, 6)}.txt`;
}
