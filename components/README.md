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

## Suggested placement on the dashboard

`WinnerBrief` reads best directly under the creative grid, while the winner is still on screen.
`RunLedger` and `ExportPanel` belong at the end of the run, after the purchase receipts: one
answers what it cost, the other lets the seller walk away with the result.

## Shared helpers

- `format.ts`: `money`, `toNumber`, `pct`, `ctr`, `clock`, `timeAgo`, `shortId`.
- `motion.ts`: `reducedMotion()` and `useCountUp`. Reduced motion is also enforced globally in
  `globals.css`, so a plain CSS transition already respects it.
