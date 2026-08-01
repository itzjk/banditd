# components

Mounting notes for the pieces in this folder. Everything below is self contained: import it,
pass the props, done. No component writes to the store or calls OpenAI.

Two palettes live here. The dashboard components paint on the dark shell
(`bg-zinc-950`, white borders at low alpha). The home page components use the semantic tokens
from `globals.css` (`card`, `field`, `eyebrow`, `border-border`, `bg-surface-2`, `text-muted`)
so they follow light and dark automatically.

---

## RunLedger

`components/RunLedger.tsx`, dark palette, dashboard.

What a seller paid for the run: model calls and their estimated cost, what was charged to the
mandate, how many impressions were served, and the cost per point of CTR won over an even split.
A collapsible section breaks the model spend into line items.

Every number is tagged: **Measured** for what came from the log or a receipt, **Estimate** for the
token derived costs, **Simulated** for anything from the traffic model.

### Props

| prop | type | default | meaning |
| --- | --- | --- | --- |
| `state` | `State \| null` | required | The agent state. `null` renders the zero state. |
| `pricing` | `Partial<LedgerPricing>` | published rates | `textInputPerMillion` 0.20, `textOutputPerMillion` 1.20, `imagePerRender` 0.01 |
| `models` | `Partial<typeof DEFAULT_MODELS>` | `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-image-1-mini` | Labels shown on the line items. Change these if `OPENAI_*_MODEL` is overridden in the env. |

Also exports `DEFAULT_PRICING` and `DEFAULT_MODELS`.

### How the numbers are derived

- Model calls come from `state.audit`: one search call per `research` entry, one text call per
  `creatives` entry, one text call per `decision` entry. If the log was trimmed, it falls back to
  the number of generations in `state.creatives`.
- Image renders are one per creative, minus any the log reports as blank
  (`N image(s) ran out of render time`).
- Tokens per call are fixed averages for these prompts, not billed usage. That is why the OpenAI
  figure is labeled an estimate.
- Charged and blocked come from `state.purchases`, which are real Prava sandbox results.
- Cost per CTR point compares the best CTR in the newest generation against the CTR the cohort
  would have had spread evenly, then divides the run total by the points of difference.

### Example

```tsx
import RunLedger from "@/components/RunLedger";

<RunLedger state={state} />
```

---

## WinnerBrief

`components/WinnerBrief.tsx`, dark palette, dashboard.

Reads as a brief a marketer would keep: the winning ad and its angle, its CTR, the impressions
behind it, the lift over the runner up, the whole field as bars, and one paragraph on what
separates first from second. Nothing here calls OpenAI.

If no `evaluation` is passed it runs `evaluate` from `lib/bandit` locally with a seeded RNG, so the
number is stable across renders and matches on the server and the client. Pass the real evaluation
from `/api/decide` when there is one and it wins over the local estimate.

### Props

| prop | type | default | meaning |
| --- | --- | --- | --- |
| `cohort` | `Creative[]` | required | The newest generation. Memoize it, the local evaluation reruns when the array identity changes. |
| `evaluation` | `BriefEvaluation \| null` | `null` | Accepts the `Evaluation` object from `DemoRunner` or `/api/decide` as is. All fields optional. |
| `winnerId` | `string \| null` | `null` | Forces the winner. Otherwise: `evaluation.candidateId`, then `candidateIndex`, then the local evaluation, then the top CTR. |
| `seed` | `number` | `7` | Seed for the local sampler. |

Empty cohort or zero impressions renders an explanatory empty state, not a blank box.

### Example

```tsx
import WinnerBrief from "@/components/WinnerBrief";

<WinnerBrief cohort={cohort} evaluation={freshEvaluation} winnerId={winnerId} />
```

---

## ExportPanel

`components/ExportPanel.tsx`, dark palette, dashboard. Pairs with `app/api/export/route.ts`.

Four buttons: the whole run as JSON, the ads as CSV, the charges as CSV, the whole run as one
sectioned CSV. Each button shows its row count and disables itself when there is nothing to write.
The file is fetched, turned into a blob and saved with the filename the route sends back.

### Props

| prop | type | default | meaning |
| --- | --- | --- | --- |
| `state` | `State \| null` | required | The run to export. |
| `endpoint` | `string` | `/api/export` | Override only if the route moves. |
| `disabled` | `boolean` | `false` | Lock the buttons while the agent is busy. |

Also exports the `ExportSection` and `ExportFormat` types.

### Example

```tsx
import ExportPanel from "@/components/ExportPanel";

<ExportPanel state={state} disabled={busy !== null} />
```

---

## app/api/export/route.ts

`POST` only. Takes the state on the body, the same way every other route does.

```jsonc
{
  "state": { /* State */ },
  "format": "json" | "csv",     // default json
  "section": "creatives" | "purchases" | "audit" | "research" | "all"  // default all
}
```

Responses:

- `200` with `Content-Type: text/csv; charset=utf-8` or `application/json; charset=utf-8`,
  `Content-Disposition: attachment; filename="banditd-<product>-<section>-<date>.<ext>"`,
  `Cache-Control: no-store` and `X-Banditd-Rows` with the row count.
- `400 NO_STATE` when the body carries no usable state.
- `400 EMPTY_RUN` when the state has no product, no creatives and no purchases.

Notes:

- The filename is built server side from a slug of the product name, so nothing from the body
  reaches the header raw.
- `format` and `section` fall back to their defaults on anything unrecognized.
- Base64 images are never written into the export. Each ad carries `hasImage` and its
  `imagePrompt` instead, which keeps the file small enough to open.
- Both formats carry a `disclosure` line saying the impressions, clicks and CTR are simulated and
  the charges are real. CSV performance columns are named `*_simulated` for the same reason.
- The `all` CSV is sectioned with `# product`, `# research`, `# creatives`, `# purchases`,
  `# audit` markers and a blank line between blocks.

```bash
curl -X POST localhost:3000/api/export \
  -H "Content-Type: application/json" \
  -d '{"state": {...}, "format": "csv", "section": "creatives"}'
```

---

## SeedPresets

`components/SeedPresets.tsx`, semantic tokens, home page.

Four example products from four categories, one tap each. Labeled as made up so nobody reads them
as real catalog entries. Meant to sit next to the product form, or to replace the single
"Use example" button.

### Props

| prop | type | default | meaning |
| --- | --- | --- | --- |
| `onPick` | `(preset: SeedPreset) => void` | required | Fired with the whole preset. Fill the form fields from it. |
| `disabled` | `boolean` | `false` | Greys out every card. |
| `className` | `string` | none | Spacing from the parent, for example `mt-5`. |

Also exports `SEED_PRESETS` and the `SeedPreset` type
(`{ id, category, name, price, description }`).

### Example

```tsx
import SeedPresets, { type SeedPreset } from "@/components/SeedPresets";

<SeedPresets
  className="mt-5"
  disabled={busy}
  onPick={(preset: SeedPreset) => {
    setName(preset.name);
    setPrice(preset.price);
    setDescription(preset.description);
    setError(null);
  }}
/>
```

---

## ProofLab

`components/ProofLab.tsx`, semantic tokens, mounted on both pages.

Mounted twice: on the home page under the two big error rate figures, and on the dashboard as the
last item of the evidence band, where it answers the question the band raises. Both mounts are
folded shut by default.

The interactive version of the error rate the README publishes. The visitor picks a hidden truth
the ads do not know about, one paired run plays out look by look, and the two decision rules read
the exact same traffic side by side: the naive rule that stops as soon as `P(best)` passes 95%, and
the four gates. Repeats pile up into a scoreboard with a convergence chart, so the false winner
rate settles in front of the visitor instead of being asserted.

Everything runs on `lib/bandit.ts` in the browser (`evaluate`, `simulateTraffic`, `createRng`,
`logMixtureBayesFactor`). No route, no key, no cost, and it still works with OpenAI or Prava down.

### Props

| prop | type | default | meaning |
| --- | --- | --- | --- |
| `className` | `string` | none | Appended to the outer `section`, which already carries `card`. |
| `defaultTruth` | `"identical" \| "winner"` | `"identical"` | Starting scenario. `identical` is the one that exposes the naive rule. |
| `defaultArms` | `2 \| 4` | `2` | Ads in the test. Two is where the naive rule fails hardest, four is the counterintuitive case. |
| `defaultLift` | `number` | `50` | Percent lift of the better ad. The control offers 25, 50 and 100. |
| `looks` | `number` | `48` | Times the data is checked inside one run. |
| `horizon` | `number` | `12000` | Impressions served per run, split evenly across the ads. |
| `batchSize` | `number` | `100` | Runs added by the repeat button and by the automatic batch. |
| `autoBatch` | `boolean` | `true` | After the live run, keep going for `batchSize - 1` more runs. |
| `seed` | `number` | `4000` | First seed. Every run advances it, so repeats are fresh but reproducible. |
| `tone` | `"auto" \| "panel"` | `"auto"` | `auto` follows light and dark from `globals.css`. `panel` pins the semantic tokens to the dashboard shell, so it reads as part of the dark panel instead of flipping to white. |
| `folded` | `boolean` | `false` | Wraps the panel in a `<details>` closed by default, with a one line summary inviting a judge to open it. Same fold pattern as the other secondary panels on the dashboard. |
| `onScore` | `(score: ProofScore) => void` | none | Fires whenever the scoreboard changes. An inline function is safe, it is held in a ref. |

Changing any control resets the scoreboard, because a new scenario is a new measurement. `seed` is
read at mount and on reset.

`tone="panel"` works by overriding the semantic tokens on the outer element with inline custom
properties. `@theme inline` in `globals.css` means every `bg-surface-2`, `text-muted`, `text-accent`
and `var(--danger)` inside the tree resolves against the override, so nothing in the panel had to be
rewritten to literals and the home page mount is untouched by it.

Also exports `ProofScore` (`runs`, `naiveFalse`, `naiveRight`, `gatedFalse`, `gatedRight`),
`ProofTruth`, `ProofTone`, `ProofSetup` and `runProofBatch`.

### Example

```tsx
import ProofLab from "@/components/ProofLab";

<ProofLab />

<ProofLab tone="panel" folded batchSize={200} />
```

Reading the score, for example to headline it above the fold:

```tsx
const [score, setScore] = useState<ProofScore | null>(null);
const wrong = score && score.runs ? (100 * score.naiveFalse) / score.runs : 0;

<ProofLab batchSize={200} onScore={setScore} />
```

### Headless helper

```ts
import { runProofBatch, type ProofSetup } from "@/components/ProofLab";

const setup: ProofSetup = { arms: 2, truth: "identical", lift: 50, looks: 48, horizon: 12000 };
const score = runProofBatch(setup, 4000, 200);
```

Same engine the component drives, but synchronous. It blocks the thread it runs on, so keep it in a
script or a test and never on a click handler.

### Keeping the interface alive

Thousands of Monte Carlo draws per look will freeze a tab if you let them.

- The unit of work is one look, not one run, so no slice runs long.
- Batches go through `requestIdleCallback` with a 64 ms timeout and fall back to
  `requestAnimationFrame`. Each slice stops after 8 ms and yields, and the runs left are on screen.
- The live run is paced by `requestAnimationFrame` at about one look every 38 ms, so traffic is
  seen arriving instead of appearing all at once.
- Before spending 20,000 samples, the gated rule checks two closed form conditions that cost
  nothing: no ad can have the minimum traffic yet, or the mixture Bayes factor is under `1 / alpha`
  so no sample count could clear the anytime valid gate. The skip is exact, the verdict cannot
  change, and under the null it removes nearly all of the sampling.
- A look that is only being displayed and cannot fire previews with 3,000 samples. The number that
  decides is always the full 20,000.
- Every scheduled loop carries a job token, so stop, reset and control changes kill work already
  queued instead of letting it run on in the background.

`prefers-reduced-motion` drops the pacing and the run resolves as fast as frames allow.

### What it measures

Defaults, two ads with the same 3.0% true click rate, 12,000 impressions checked 48 times.
Measured in the browser, runs where a winner was declared:

| runs | naive rule | four gates |
| --- | --- | --- |
| 200 | 44.5% | 0.5% |
| 2000 | 48.9% | 0.35% |

The 44.5% and 0.5% in the root README come from a 200 run sample. Let the lab keep going and the
naive rule settles near 49%, so the lab is harder on it than the README is, not softer. With four
identical ads the naive rate falls to roughly 7%, which is the point worth making out loud: 95% is
harder to reach with more ads to beat, so the error hides rather than disappears.

---

## MerchantHandshake

`components/MerchantHandshake.tsx`, semantic tokens, works on either page. Pairs with
`app/api/merchant/route.ts` and `lib/ucp.ts`. Mounted on its own at `/merchant-check`.

Answers the hardest question the demo gets: the render credit merchant is a stand in, so does this
agent only work against a merchant we made up? The panel points the agent at a real store that
publishes the Universal Commerce Protocol, reads that store's profile live, and shows the version,
transports, capabilities and payment handlers it declares. Then it runs a catalog search through the
store's own MCP endpoint, identifying itself with the agent profile banditd publishes at
`/.well-known/ucp-agent.json`.

Nothing is bought. The panel says so in a footer that no prop can turn off. The profile banditd
publishes declares catalog search and catalog lookup only, no cart, no checkout and no payment
handler, so the protocol itself would refuse a purchase attempt.

Three stores are verified to answer: `allbirds.com`, `decathlon.com`, `littleboxindia.com`. Any
other domain can be typed in, and a store that does not speak the protocol renders a plain sentence
saying so rather than an error.

### Props

| prop | type | default | meaning |
| --- | --- | --- | --- |
| `domains` | `string[]` | `VERIFIED_DOMAINS` | The one tap chips above the form. |
| `defaultDomain` | `string` | `allbirds.com` | What the domain field starts with. |
| `defaultQuery` | `string` | `best seller` | What the catalog is asked for. |
| `endpoint` | `string` | `/api/merchant` | Override only if the route moves. |
| `className` | `string` | none | Spacing from the parent. |

Also exports `VERIFIED_DOMAINS` and the `MerchantHandshakeResponse` type. The panel never fetches on
mount, so embedding it costs nothing until someone presses the button.

### Example

```tsx
import MerchantHandshake from "@/components/MerchantHandshake";

<MerchantHandshake className="mt-6" defaultDomain="decathlon.com" defaultQuery="running shoes" />
```

---

## app/api/merchant/route.ts

`GET /api/merchant?domain=allbirds.com&query=shoes`, or `POST` with the same keys on the body
(`domain`, `query`, `country`, `profile`). Read only. It never opens a cart, a checkout or an order,
and it holds no credential.

Responses:

- `400 NO_DOMAIN` when no domain was sent. The only non `200` it can return.
- `200` otherwise, always with `Cache-Control: no-store` and this shape:

```jsonc
{
  "ok": true,              // the store answered and speaks UCP
  "domain": "allbirds.com",
  "profileUrl": "https://banditd.vercel.app/.well-known/ucp-agent.json",
  "summary": "allbirds.com speaks UCP 2026-04-08. ...",
  "purchased": false,      // always false, this route cannot buy
  "ms": 812,
  "discovery": { /* Discovery from lib/ucp */ },
  "catalog": { /* CatalogOutcome from lib/ucp, or null */ }
}
```

A store that is down, that returns `404`, that answers with something other than JSON, or that has
no `ucp` block comes back as `ok: false` with a sentence in `summary` saying which of those it was.
Nothing throws.

`profileUrl` is built server side from `BANDITD_PUBLIC_ORIGIN`, or from the forwarded host when the
request arrives over https, and falls back to the production origin when running on localhost. That
matters because the store fetches this URL before it will answer, so it has to be publicly reachable.

```bash
curl -s "localhost:3000/api/merchant?domain=decathlon.com&query=running%20shoes"
```

---

## lib/ucp.ts

The client behind the route. No dependencies, nothing cached, every call bounded.

- `normalizeDomain(input)` accepts `allbirds.com`, `https://allbirds.com/anything` and mixed case,
  and returns the bare hostname or `null`.
- `discoverMerchant(domain, timeoutMs = 6000)` fetches `https://<domain>/.well-known/ucp` and reads
  the version, the transports, the MCP endpoint, the capability names and the payment handler names.
  Resolves to a tagged result, never rejects. Reasons: `invalid_domain`, `blocked_host`,
  `unreachable`, `http_error`, `too_large`, `not_json`, `not_ucp`.
- `searchCatalog({ endpoint, profileUrl, query, country })` calls `search_catalog` over JSON-RPC with
  `meta["ucp-agent"].profile` set, nine second ceiling. Understands a plain JSON body, a Server Sent
  Events body, `structuredContent`, and a tool result carrying JSON as text. Prices arrive in minor
  units and are formatted from `price_range.min`.
- `greetMerchant({ domain, profileUrl, query, country })` runs both and is what the route calls.

Guards worth knowing about: private and link local hostnames and bare IP addresses are refused, so a
domain typed into the panel cannot be used to probe the network the server sits on. Response bodies
are read through a capped reader and abandoned past 768 KB. Both steps use `AbortSignal.timeout`, so
a store that hangs mid demo costs six seconds, not the page.

---

## public/.well-known/ucp-agent.json

The agent profile. UCP requires a platform to advertise a public profile URL on every request, and
the store fetches it before it answers, so this file is what makes the handshake legal. It declares
protocol `2026-04-08`, the MCP transport, `catalog.search` and `catalog.lookup`, and an empty
`payment_handlers` map, which is the honest declaration for an agent that only reads.

Two hosting rules from the spec are enforced by Shopify and are easy to miss:

1. The file must be served over https with no redirect.
2. The response must carry `Cache-Control: public` with `max-age` of at least 60 seconds. Vercel
   serves `public/` with `max-age=0` by default, which the store rejects as `profile_malformed`
   with the message `Invalid cache control`. `next.config.ts` sets `public, max-age=300` on
   `/.well-known/:file*` for exactly this reason. Do not remove it.

`ucp-agent-min.json` sits next to it with the same `ucp` block and none of the descriptive fields.
It exists as a fallback to point at, in case a store rejects the extra top level keys.

---

## Suggested placement on the dashboard

`WinnerBrief` reads best directly under the creative grid, while the winner is still on screen.
`RunLedger` and `ExportPanel` belong at the end of the run, after the purchase receipts: one
answers what it cost, the other lets the seller walk away with the result.

`MerchantHandshake` belongs wherever the merchant gets explained, next to the first purchase receipt
or right under it. It is the answer to "your merchant is invented", so it should be one scroll away
from the charge.

## Shared helpers

- `format.ts`: `money`, `toNumber`, `pct`, `ctr`, `clock`, `timeAgo`, `shortId`.
- `motion.ts`: `reducedMotion()` and `useCountUp`. Reduced motion is also enforced globally in
  `globals.css`, so a plain CSS transition already respects it.
