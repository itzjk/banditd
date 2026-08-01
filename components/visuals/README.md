# banditd visual system

Reusable visual pieces. No dependencies, no external images, no external requests. Everything is
inline SVG, canvas or CSS driven by the tokens in `app/globals.css`, so light and dark both work
with no extra props.

Type is IBM Plex Sans and IBM Plex Mono, both loaded through `next/font` in `app/layout.tsx` and
exposed as `--font-sans-face` and `--font-mono-face`. Plex draws its digits on a single width, so
figures line up in a column even where nothing asks for tabular numerals.

Import from the barrel:

```tsx
import { MeshField, Surface, BanditLearning, Shelf, BigNumber, Reveal, ParallaxLayer, Divider } from "@/components/visuals";
import { Display, Headline, Title, Lead, Body, Small, Caption, Eyebrow, Mono } from "@/components/visuals";
```

Rules baked in:

- Only `transform` and `opacity` animate. Nothing animates width, top or height.
- `prefers-reduced-motion: reduce` stops every loop and reveal. The global rule in `globals.css`
  collapses durations, and each animation is authored so its final keyframe is the meaningful
  resting state.
- Every component takes `className`, so spacing stays with the page, not with the piece.
- Any wrapper takes `as` to pick its element. Pass any tag or component: `as="figure"`,
  `as="section"`, `as="li"`.

---

## MeshField

Background field for a whole page or a single section. Two layers, both masked so they fade well
before they reach the content.

- The **grid** layer is a static CSS gradient. It costs nothing and it can cover a whole page.
- The **flow** layer is a canvas: four horizontal lanes carrying traffic left to right, one lane per
  creative. Over a 24 second cycle the allocation moves from even to concentrated, so dots respawn
  into the leading lane and its guide line brightens. It is the same story the hero tells, at
  wallpaper volume.

The flow layer only paints inside a band in the middle of its box, so the canvas is sized to that
band rather than to the whole field. Its backing store is capped at 2.4M pixels, the loop stops when
the field scrolls out of view or the tab is hidden, and under `prefers-reduced-motion: reduce` it
paints the converged state once and never starts a frame loop.

| prop | type | default | what it does |
| --- | --- | --- | --- |
| `variant` | `"mesh" \| "grid" \| "flow" \| "contour"` | `"mesh"` | `mesh` is both layers, `grid` is the static layer alone, `flow` is the canvas alone, `contour` is kept as an alias of `flow` |
| `intensity` | `"faint" \| "soft" \| "medium"` | `"soft"` | how present the field is |
| `parallax` | `boolean` | `true` | scroll parallax on both layers, off under reduced motion |
| `position` | `"fixed" \| "absolute"` | `"fixed"` | `fixed` covers the viewport, `absolute` scopes it to the nearest positioned parent |
| `className` | `string` | `""` | extra classes |

The field renders at `z-index: 0` and is `aria-hidden`, so give your content a stacking context
above it.

Use `grid` for anything page wide and keep `flow` scoped to one section, so only one canvas is ever
running.

```tsx
<div className="relative">
  <MeshField variant="grid" intensity="faint" />
  <main className="relative z-10">{children}</main>
</div>
```

Scoped to one section:

```tsx
<section className="relative isolate overflow-hidden">
  <MeshField variant="flow" position="absolute" />
  <div className="relative z-10">{children}</div>
</section>
```

---

## Surface

Four levels of container so importance is visible before anything is read.

- `quiet`: inset block, flat, no shadow. For secondary panels inside another surface.
- `base`: the default card.
- `raised`: brighter fill, real shadow, a hairline bevel on the top edge.
- `feature`: gradient fill, stronger border, deep shadow, larger radius. One per screen.

| prop | type | default | what it does |
| --- | --- | --- | --- |
| `level` | `"quiet" \| "base" \| "raised" \| "feature"` | `"base"` | the depth step |
| `as` | any element or component | `"div"` | `figure`, `section`, `li`, `article`, anything |
| `interactive` | `boolean` | `false` | hover lift, press, and a focus ring |
| `padded` | `boolean` | `false` | padding matched to the level, skip it and pass your own |
| `className` | `string` | `""` | extra classes |

All remaining props pass through to the element, so `onClick`, `id`, `role` and the rest work.

```tsx
<Surface level="feature" padded>
  <Title>Spend mandate</Title>
  <Small>Revocable at any time.</Small>
</Surface>

<Surface level="raised" as="figure" padded interactive onClick={open}>
  <BanditLearning />
</Surface>
```

---

## BanditLearning

The hero piece, built to read as an instrument rather than an illustration. Four posterior curves
start identical and overlapping, then narrow and separate across a labelled conversion rate axis
while the traffic bar underneath reallocates to the leader. It takes no data, it is honest
decoration that shows what the product does.

What is on it:

- A plot with a density axis on the left, density gridlines, and a conversion rate axis underneath
  with ticks and per cent values. The four curves land on real positions on that axis, and the
  leader is the rightmost one, so the picture and the numbers agree.
- A letter per curve, tracking its peak. The letters are fanned slightly so they stay apart while
  the curves are still stacked.
- A dashed cursor on the leading curve, which fades in as the lead becomes real.
- The traffic bar, with hairline separators between segments and its own 0 to 100 per cent scale, so
  the winner's share can be read off rather than guessed.
- A cycle track from explore to exploit, so the loop reads as a state the run moves through instead
  of an animation that happens to reverse.

Everything is sized from the measured container width, so the caption is 11px and the tick labels
are 10px whether the box is 300px or 700px wide. Nothing is dropped on a phone, it just gets
proportionally larger inside the same viewBox. Under reduced motion it renders the converged state,
which is the state worth seeing.

| prop | type | default | what it does |
| --- | --- | --- | --- |
| `tone` | `"spectrum" \| "accent"` | `"spectrum"` | `spectrum` uses the four creative colors from the dashboard, `accent` keeps three arms neutral and the winner in brand green |
| `labels` | `[string, string, string, string]` | `["A","B","C","D"]` | the letter that tracks each curve |
| `caption` | `string` | `"belief per creative"` | top left mono caption, pass `""` to hide |
| `allocationLabel` | `string` | `"traffic share"` | caption over the bar, pass `""` to hide |
| `rateLabel` | `string` | `"conversion rate"` | title under the horizontal axis, pass `""` to hide |
| `densityLabel` | `string` | `"density"` | rotated title on the vertical axis, pass `""` to hide |
| `cycleLabels` | `[string, string]` | `["explore","exploit"]` | the two ends of the cycle track |
| `showAllocation` | `boolean` | `true` | show the traffic bar and its scale |
| `showCycle` | `boolean` | `true` | show the cycle track |
| `loopSeconds` | `number` | `11` | one direction of the loop |
| `title` | `string` | see source | the accessible label, it is `role="img"` |
| `className` | `string` | `""` | extra classes on the wrapper |

It fills the width it is given and keeps its ratio. Give it room. On a phone let it run close to
full width instead of nesting it inside a heavily padded card.

```tsx
<Surface level="feature" className="p-4 sm:p-8">
  <BanditLearning />
</Surface>

<BanditLearning tone="accent" caption="" showAllocation={false} showCycle={false} />
```

The geometry is shared with `app/globals.css`. The `bd-arm-*`, `bd-mean-*`, `bd-share-*`, `bd-lead`
and `bd-cycle` keyframes are written in the same 640 unit coordinate space as the component, so a
change to `PLOT_L`, `PLOT_W` or `CENTER` means recomputing those translations.

---

## Shelf

Horizontal rail of cards with a peek of the next one. Momentum scroll on touch, snap points, no
scrollbar, arrows on desktop, and a thin progress indicator. Arrows and indicator only appear when
the content actually overflows.

Children are wrapped in `li` inside a labelled `ul`, so pass cards directly.

| prop | type | default | what it does |
| --- | --- | --- | --- |
| `children` | `ReactNode` | required | one card per child |
| `ariaLabel` | `string` | required | names the scrollable list |
| `as` | any element or component | `"div"` | the outer wrapper |
| `title` | `ReactNode` | none | heading rendered on the control row |
| `itemClassName` | `string` | `"w-[78%] sm:w-[52%] lg:w-[33%]"` | card width, this is what creates the peek |
| `gap` | `"sm" \| "md" \| "lg"` | `"md"` | space between cards |
| `controls` | `boolean` | `true` | arrows, desktop only |
| `indicator` | `boolean` | `true` | progress bar under the rail |
| `fadeEdges` | `boolean` | `true` | masks both ends so cards fade instead of cutting |
| `snap` | `boolean` | `true` | snap each card to the left edge |
| `wheel` | `boolean` | `false` | turn a vertical wheel into horizontal movement, only while the rail can still move |
| `className` | `string` | `""` | extra classes |

Give cards `h-full` if you want equal heights, the `li` already stretches.

```tsx
<Shelf ariaLabel="How it works" title="How it works">
  {steps.map((s) => (
    <Surface key={s.n} level="raised" padded className="h-full">
      <Eyebrow>{s.n}</Eyebrow>
      <Title className="mt-2">{s.title}</Title>
      <Small className="mt-2">{s.body}</Small>
    </Surface>
  ))}
</Shelf>
```

---

## BigNumber

A figure used as an argument, with its label under it. Counts up once when it scrolls into view, and
lands on the final value immediately under reduced motion. Digits are tabular so nothing jitters
while counting.

| prop | type | default | what it does |
| --- | --- | --- | --- |
| `value` | `number \| string` | required | a number counts up, a string renders as is |
| `label` | `ReactNode` | required | the line under the figure |
| `as` | any element or component | `"div"` | the wrapper |
| `detail` | `ReactNode` | none | the quiet line under the label |
| `prefix` | `string` | none | rendered at half size, for `$` |
| `suffix` | `string` | none | rendered at half size, for `%` |
| `decimals` | `number` | `0` | decimal places while counting |
| `countUp` | `boolean` | `true` | set false to render the value flat |
| `duration` | `number` | `900` | count duration in ms |
| `align` | `"start" \| "center"` | `"start"` | text alignment |
| `tone` | `"default" \| "accent"` | `"default"` | accent paints the figure in brand green |
| `className` | `string` | `""` | extra classes |

```tsx
<BigNumber value={44.5} decimals={1} suffix="%" label="Detection rate" detail="At a 0.5 percent false positive rate." />
<BigNumber value={100} suffix="%" label="Precision when it fires" tone="accent" />
<BigNumber value="4" countUp={false} label="Gates before a charge" />
```

---

## Reveal

Wrapper that fades and lifts its child when it enters the viewport, once. Under reduced motion the
child simply appears. Stagger a group by passing an increasing `delay`.

| prop | type | default | what it does |
| --- | --- | --- | --- |
| `children` | `ReactNode` | required | what gets revealed |
| `as` | any element or component | `"div"` | the wrapper |
| `delay` | `number` | `0` | ms before it starts |
| `distance` | `number` | `16` | px it travels up |
| `threshold` | `number` | `0.15` | how much must be visible to trigger |
| `once` | `boolean` | `true` | set false to re-hide when it leaves |
| `className` | `string` | `""` | extra classes |

Keep the delays short. Past roughly 400ms a stagger stops feeling like design and starts feeling
like lag.

```tsx
{features.map((f, i) => (
  <Reveal key={f.id} delay={i * 80} as="li">
    <Surface level="base" padded>{f.title}</Surface>
  </Reveal>
))}
```

---

## ParallaxLayer

Moves its child slower than the page. Meant for decorative layers. It shifts the element visually
without changing layout, so on an element that is in normal flow with tight spacing it can overlap a
neighbour. Use it on absolutely positioned decoration, or leave generous space around it.

| prop | type | default | what it does |
| --- | --- | --- | --- |
| `children` | `ReactNode` | required | what drifts |
| `as` | any element or component | `"div"` | the wrapper |
| `speed` | `number` | `0.06` | fraction of the scroll distance, negative moves the other way |
| `max` | `number` | `44` | px cap in each direction |
| `className` | `string` | `""` | extra classes |

```tsx
<section className="relative isolate overflow-hidden">
  <ParallaxLayer speed={0.05} className="absolute inset-x-0 -top-10 -z-10">
    <MeshField position="absolute" variant="contour" parallax={false} />
  </ParallaxLayer>
  <div className="relative">{children}</div>
</section>
```

---

## Divider

Separator that fades at the ends instead of stopping dead, with an optional mono label.

| prop | type | default | what it does |
| --- | --- | --- | --- |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | vertical needs a parent with a height |
| `label` | `ReactNode` | none | centered label with a rule on each side |
| `className` | `string` | `""` | extra classes |

```tsx
<Divider />
<Divider label="how it works" className="my-12" />
<Divider orientation="vertical" className="mx-6" />
```

---

## Typography

Nine steps, each one a component and a class. The components are the shortcut, the classes work
anywhere including inside markup you do not control.

| component | class | size | use |
| --- | --- | --- | --- |
| `Display` | `.t-display` | 34 to 68px fluid | one per page, the opening statement |
| `Headline` | `.t-headline` | 26 to 40px fluid | section openers |
| `Title` | `.t-title` | 18 to 22px fluid | card and panel titles |
| `Lead` | `.t-lead` | 17 to 20px fluid | the sentence under a display or headline |
| `Body` | `.t-body` | 16px | paragraphs |
| `Small` | `.t-small` | 14px | supporting lines |
| `Caption` | `.t-caption` | 13px | the quietest step |
| `Eyebrow` | `.t-eyebrow` | 11px mono caps | labels above a title |
| `Mono` | `.t-mono` | 13px mono | ids, amounts, anything technical |

Extra classes: `.t-figure` for the huge number `BigNumber` uses, and `.t-num` to force tabular
digits on any element whose value changes.

Every one takes `as` and `className`.

```tsx
<Eyebrow>agentic commerce</Eyebrow>
<Display>An agent that measures, then spends.</Display>
<Lead as="p">Four creatives start equal.</Lead>
<Title as="h2" className="mt-8">Guardrails</Title>
<Mono>mnd_01KYX</Mono>
```

---

## Finishing classes

Available globally, no import needed.

| class | what it does |
| --- | --- |
| `.surface-quiet` `.surface-base` `.surface-raised` `.surface-feature` | what `Surface` applies, use directly on markup you already have |
| `.surface-interactive` | hover lift, press, needs a positioned element |
| `.edge-glow` | the hairline bevel on its own, on any element with a radius |
| `.hover-lift` | 2px lift on hover, pointer devices only |
| `.hover-tint` | consistent 160ms color, background and border transition |
| `.focus-ring` | intentional focus state, transparent until `:focus-visible`, then it steps outward |
| `.hairline` | gradient rule that fades at both ends, add `.hairline-in` or `.hairline-out` for one sided |
| `.hairline-vertical` | the vertical version |

Tokens worth knowing, all defined for light and dark in `app/globals.css`:
`--surface`, `--surface-2`, `--surface-raised`, `--border`, `--border-strong`, `--accent`,
`--muted`, `--subtle`, `--grid-line`, `--grid-fine`, `--edge-hi`, `--edge-lo`,
`--shadow-base`, `--shadow-raised`, `--shadow-feature`, `--shadow-lift`, and `--arm-1` to `--arm-4`
for the four creatives.

---

## Assembling a page

```tsx
<div className="relative">
  <MeshField />
  <main className="relative z-10 mx-auto max-w-5xl px-gutter py-section">
    <Eyebrow>agentic commerce</Eyebrow>
    <Display className="mt-4">An agent that measures, then spends.</Display>
    <Lead className="mt-5 max-w-xl">Four creatives start equal.</Lead>

    <Surface level="feature" className="mt-10 p-4 sm:p-8">
      <BanditLearning />
    </Surface>

    <Divider label="results" className="my-16" />

    <div className="grid gap-10 sm:grid-cols-3">
      <Reveal><BigNumber value={44.5} decimals={1} suffix="%" label="Detection rate" /></Reveal>
      <Reveal delay={80}><BigNumber value={100} suffix="%" label="Precision when it fires" tone="accent" /></Reveal>
      <Reveal delay={160}><BigNumber value="4" countUp={false} label="Gates before a charge" /></Reveal>
    </div>
  </main>
</div>
```
