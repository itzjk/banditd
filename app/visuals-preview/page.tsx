"use client";

import {
  BanditLearning,
  BigNumber,
  Divider,
  Display,
  Eyebrow,
  Headline,
  Lead,
  MeshField,
  ParallaxLayer,
  Reveal,
  Shelf,
  Small,
  Surface,
  Title,
} from "@/components/visuals";

const CARDS = [
  { n: "01", t: "Researches the market", b: "Who buys this, what competitors claim, where the price lands." },
  { n: "02", t: "Writes four ads", b: "Four angles, four images, four sets of copy." },
  { n: "03", t: "Measures the winner", b: "Every ad is an arm, scored with Thompson sampling." },
  { n: "04", t: "Buys its own credits", b: "Four gates agree, then it charges through Prava." },
  { n: "05", t: "Logs everything", b: "Every decision leaves a receipt you can audit." },
];

export default function VisualsPreview() {
  return (
    <div className="relative">
      <MeshField />

      <main className="relative z-10 mx-auto max-w-5xl px-gutter py-section space-y-section">
        <section className="space-y-6">
          <Eyebrow>visual system</Eyebrow>
          <Display>An agent that measures, then spends.</Display>
          <Lead>
            Four creatives start equal. Traffic moves to the one that earns it, and nothing is
            charged until the evidence holds up.
          </Lead>
          <Surface level="feature" padded>
            <BanditLearning />
          </Surface>
        </section>

        <Divider label="surfaces" />

        <section className="grid gap-4 sm:grid-cols-2">
          <Surface level="quiet" padded>
            <Title>Quiet</Title>
            <Small>Inset panels, secondary blocks.</Small>
          </Surface>
          <Surface level="base" padded>
            <Title>Base</Title>
            <Small>Default container.</Small>
          </Surface>
          <Surface level="raised" padded interactive>
            <Title>Raised</Title>
            <Small>Hover me, I lift.</Small>
          </Surface>
          <Surface level="feature" padded>
            <Title>Feature</Title>
            <Small>The one thing that matters here.</Small>
          </Surface>
        </section>

        <Divider label="numbers" />

        <section className="grid gap-8 sm:grid-cols-3">
          <BigNumber value={44.5} decimals={1} suffix="%" label="Detection rate" detail="At a 0.5 percent false positive rate." />
          <BigNumber value={100} suffix="%" label="Precision when it fires" tone="accent" />
          <BigNumber value="4" label="Gates before a charge" countUp={false} />
        </section>

        <Divider label="shelf" />

        <Shelf ariaLabel="How it works" title="How it works" wheel>
          {CARDS.map((c) => (
            <Surface key={c.n} level="raised" padded className="h-full">
              <Eyebrow>{c.n}</Eyebrow>
              <Title className="mt-2">{c.t}</Title>
              <Small className="mt-2">{c.b}</Small>
            </Surface>
          ))}
        </Shelf>

        <Divider label="reveal and parallax" />

        <section className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <Reveal key={i} delay={i * 90}>
              <Surface level="base" padded>
                <Title>Reveal {i + 1}</Title>
                <Small>Appears on scroll, {i * 90}ms after the section enters.</Small>
              </Surface>
            </Reveal>
          ))}
          <ParallaxLayer speed={0.08}>
            <Surface level="quiet" padded>
              <Headline>Parallax layer</Headline>
              <Small>Drifts slower than the page.</Small>
            </Surface>
          </ParallaxLayer>
        </section>

        <Divider />

        <section className="space-y-3 pb-section">
          <Display as="h2">Display</Display>
          <Headline>Headline</Headline>
          <Title>Title</Title>
          <Lead>Lead paragraph for the sentence that carries the section.</Lead>
          <p className="t-body">Body copy sits here at a comfortable measure and rhythm.</p>
          <Small>Small supporting line.</Small>
          <p className="t-caption">Caption, the quietest step.</p>
        </section>
      </main>
    </div>
  );
}
