"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { State } from "@/lib/store";
import Glossary from "@/components/Glossary";
import {
  BanditLearning,
  BigNumber,
  Body,
  Caption,
  Display,
  Eyebrow,
  Headline,
  Lead,
  MeshField,
  Mono,
  prefersReducedMotion,
  Shelf,
  Small,
  Surface,
  Title,
} from "@/components/visuals";

const STORAGE_KEY = "banditd_state";

function saveState(value: State) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...value,
        creatives: (value.creatives ?? []).map((c) => ({ ...c, imageData: null })),
      }),
    );
  } catch {
    return;
  }
}

const EXAMPLE = {
  name: "Cold-Pressed Coffee Concentrate",
  price: "$28.00",
  description: "A 32oz bottle of slow-steeped concentrate that makes 16 cups.",
};

const DISPLAY_XL = "text-[clamp(2.25rem,8.4vw,4.5rem)]";
const SECTION_PAD = "py-20 sm:py-28 lg:py-32";
const RISE_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

const riseCallbacks = new WeakMap<Element, () => void>();
let riseObserver: IntersectionObserver | null = null;

function getRiseObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver !== "function") return null;
  if (riseObserver) return riseObserver;
  riseObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const fire = riseCallbacks.get(entry.target);
        riseCallbacks.delete(entry.target);
        observer.unobserve(entry.target);
        fire?.();
      }
    },
    { rootMargin: "200000px 0px -8% 0px", threshold: 0 },
  );
  return riseObserver;
}

function Rise({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;
    const observer = prefersReducedMotion() ? null : getRiseObserver();
    if (!observer) {
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    riseCallbacks.set(node, () => setShown(true));
    observer.observe(node);
    return () => {
      riseCallbacks.delete(node);
      observer.unobserve(node);
    };
  }, [shown]);

  const style: CSSProperties = shown
    ? {
        opacity: 1,
        transform: "none",
        transition: `opacity 380ms ${RISE_EASE} ${delay}ms, transform 380ms ${RISE_EASE} ${delay}ms`,
      }
    : { opacity: 0, transform: "translate3d(0, 16px, 0)" };

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none">
      <rect x="2" y="13" width="4" height="9" rx="1.2" fill="currentColor" opacity="0.35" />
      <rect x="8" y="9" width="4" height="13" rx="1.2" fill="currentColor" opacity="0.5" />
      <rect x="14" y="2" width="4" height="20" rx="1.2" fill="var(--accent)" />
      <rect x="20" y="15" width="2" height="7" rx="1" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" className={className}>
      <path
        d="M4 12h15m0 0-5.5-5.5M19 12l-5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlyphResearch() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden fill="none" className="size-full">
      <circle cx="17" cy="17" r="8.5" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <path d="M23.5 23.5 30 30" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M12 15h10M12 19h6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

function GlyphWrite() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden fill="none" className="size-full">
      <rect x="6" y="6" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <rect x="21" y="6" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <rect x="6" y="21" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <rect x="21" y="21" width="13" height="13" rx="2.5" stroke="var(--accent)" strokeWidth="1.7" />
      <path d="M24.5 26h6M24.5 29.5h3.5" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function GlyphMeasure() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden fill="none" className="size-full">
      <path d="M5 33h30" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
      <rect x="7" y="23" width="5" height="8" rx="1.4" fill="currentColor" opacity="0.3" />
      <rect x="15" y="18" width="5" height="13" rx="1.4" fill="currentColor" opacity="0.42" />
      <rect x="23" y="8" width="5" height="23" rx="1.4" fill="var(--accent)" />
      <rect x="31" y="26" width="4" height="5" rx="1.3" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

function GlyphSpend() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden fill="none" className="size-full">
      <rect x="4" y="10" width="32" height="20" rx="3" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <path d="M4 17h32" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <path d="M9 24h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
      <path
        d="m22.5 24.5 3 3 5.5-6"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ANGLES: { n: string; name: string; body: string }[] = [
  {
    n: "01",
    name: "Price",
    body: "Cost per cup against the café you were going to walk into anyway. The argument is arithmetic, and the buyer can check it.",
  },
  {
    n: "02",
    name: "Ritual",
    body: "The morning it belongs to. Sold as a habit the buyer already has, not as a bottle they do not.",
  },
  {
    n: "03",
    name: "Gift",
    body: "Who you would hand it to, and why it still reads as considered once it has been wrapped.",
  },
  {
    n: "04",
    name: "Quality",
    body: "What eighteen hours of cold steeping does to a bean that hot water never gets near.",
  },
];

const STEPS: {
  n: string;
  title: string;
  body: ReactNode;
  aside: string;
  glyph: ReactNode;
}[] = [
  {
    n: "01",
    title: "Researches the market",
    body: "Web search on who buys this, what competitors claim, and where your price lands. The dashboard lists the pages it actually read, not a claim that it read something.",
    aside: "Live web search",
    glyph: <GlyphResearch />,
  },
  {
    n: "02",
    title: "Writes four ads",
    body: "Four angles, four images, four sets of copy. The angle is an enum in the schema, so what comes back is four different arguments and not four rewordings of one.",
    aside: "Structured outputs",
    glyph: <GlyphWrite />,
  },
  {
    n: "03",
    title: "Measures which one wins",
    body: (
      <>
        Each ad is an arm on a <Glossary term="multi-armed-bandit" />, and traffic is allocated by{" "}
        <Glossary term="thompson-sampling" />, so the ad that is currently ahead earns more of the
        traffic while it is still proving itself.
      </>
    ),
    aside: "Thompson sampling",
    glyph: <GlyphMeasure />,
  },
  {
    n: "04",
    title: "Buys its own credits",
    body: (
      <>
        Once <Glossary term="four-gates" /> agree, enough traffic, one ad clearly ahead, a gap worth
        money, and a result that holds up to repeated looks, it charges more render credits through
        Prava, with no approval step.
      </>
    ),
    aside: "Agent initiated",
    glyph: <GlyphSpend />,
  },
];

const GUARDRAILS: { label: string; detail: string }[] = [
  { label: "Max spend", detail: "A ceiling the card network itself refuses to cross." },
  { label: "Allowed merchant", detail: "One listed merchant, and nothing else." },
  { label: "Expiry date", detail: "The permission runs out on its own." },
  { label: "Revocable anytime", detail: "One tap and the agent has nothing left to charge." },
];

const HERO_STATS: { value: string; label: string }[] = [
  { value: "4", label: "ads per run" },
  { value: "0.5%", label: "false winner rate" },
  { value: "100%", label: "correct pick when it fires" },
];

const METHOD: { value: string; label: string }[] = [
  { value: "200", label: "runs per cell" },
  { value: "48", label: "looks per run" },
  { value: "20,000", label: "samples per posterior" },
];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function fillExample() {
    setName(EXAMPLE.name);
    setPrice(EXAMPLE.price);
    setDescription(EXAMPLE.description);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price, description }),
      });
      const data = (await res.json().catch(() => null)) as (State & { error?: string }) | null;
      if (!res.ok) {
        setError(data?.error ?? "Could not save the product. Try again.");
        setBusy(false);
        return;
      }
      if (data) saveState(data);
      router.push("/dashboard");
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col [overflow-wrap:anywhere]">
      <MeshField variant="grid" intensity="faint" parallax position="fixed" />

      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-gutter py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Mark className="size-5 shrink-0 text-foreground" />
            <span className="truncate text-[0.9375rem] font-semibold tracking-tight">banditd</span>
            <span className="hidden text-sm text-muted sm:inline">ad agent</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted md:inline-flex">
              <span className="size-1.5 rounded-full bg-accent" />
              Prava sandbox
            </span>
            <a
              href="#start"
              className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground rounded-lg bg-foreground px-3.5 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90"
            >
              Start a run
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        <section className="relative overflow-hidden border-b border-border">
          <MeshField variant="contour" intensity="soft" parallax position="absolute" />
          <div className="relative mx-auto w-full max-w-5xl px-gutter pb-16 pt-12 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-16">
            <div className="enter max-w-4xl">
              <Eyebrow className="text-muted">Agentic commerce</Eyebrow>
              <Display className={`mt-4 ${DISPLAY_XL}`}>
                An agent that runs your ads and spends its own money on the ones that work.
              </Display>
              <Lead className="mt-5 max-w-2xl">
                Give it a product. It researches the market, writes the ads, watches which one
                actually wins, and once the evidence is statistical it buys more render credits by
                itself through Prava, inside the limits you set.
              </Lead>
            </div>

            <dl
              className="enter mt-8 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-5 sm:mt-9"
              style={{ animationDelay: "80ms" }}
            >
              {HERO_STATS.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <dd className="t-num text-[clamp(1.5rem,3vw,2.125rem)] font-semibold leading-none tracking-[-0.03em]">
                    {stat.value}
                  </dd>
                  <Eyebrow as="dt" className="mt-2 text-muted">
                    {stat.label}
                  </Eyebrow>
                </div>
              ))}
            </dl>

            <div className="mt-9 grid items-start gap-6 sm:mt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] lg:gap-10">
              <div className="enter order-2 min-w-0 lg:order-1" style={{ animationDelay: "200ms" }}>
                <Surface level="raised" className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
                    <Eyebrow as="span" className="min-w-0 text-muted">
                      Four beliefs, narrowing
                    </Eyebrow>
                    <Mono className="min-w-0 text-muted">simulated traffic</Mono>
                  </div>
                  <div className="px-3 py-4 sm:px-4 sm:py-5">
                    <BanditLearning caption="belief per ad" allocationLabel="traffic share" />
                  </div>
                </Surface>
              </div>

              <div className="enter order-1 min-w-0 lg:order-2" style={{ animationDelay: "120ms" }}>
                <Surface level="feature" id="start" className="scroll-mt-24 p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Title as="h2">Start with a product</Title>
                      <Small className="mt-1">Name, price, one line about it.</Small>
                    </div>
                    <button
                      type="button"
                      onClick={fillExample}
                      className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground hover-tint shrink-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-medium text-muted hover:border-border-strong hover:text-foreground"
                    >
                      Use example
                    </button>
                  </div>

                  <form onSubmit={onSubmit} className="mt-5 space-y-4">
                    <div>
                      <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                        Product name
                      </label>
                      <input
                        id="name"
                        name="name"
                        className="field"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Cold-Pressed Coffee Concentrate"
                        autoComplete="off"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="price" className="mb-1.5 block text-sm font-medium">
                        Price
                      </label>
                      <input
                        id="price"
                        name="price"
                        className="field"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="$28.00"
                        inputMode="decimal"
                        autoComplete="off"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="description" className="mb-1.5 block text-sm font-medium">
                        One line about it
                      </label>
                      <textarea
                        id="description"
                        name="description"
                        className="field resize-none"
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="A 32oz bottle of slow-steeped concentrate that makes 16 cups."
                        required
                      />
                    </div>

                    {error ? (
                      <p
                        role="alert"
                        className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                      >
                        {error}
                      </p>
                    ) : null}

                    <button
                      type="submit"
                      disabled={busy}
                      className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground w-full rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? "Handing it to the agent" : "Hand it to the agent"}
                    </button>

                    <Caption className="text-muted">
                      Performance numbers in the demo are simulated and labeled in the dashboard.
                      Payments run against the Prava sandbox.
                    </Caption>
                  </form>
                </Surface>
              </div>
            </div>
          </div>
        </section>

        <section className={`border-b border-border ${SECTION_PAD}`}>
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Eyebrow className="text-muted">What it makes</Eyebrow>
              <Headline className="mt-4 max-w-2xl">
                Four arguments, not four rewordings of one.
              </Headline>
              <Body className="mt-4 max-w-xl text-muted">
                The creative schema names the angle, so the four ads have to disagree with each
                other. Each one becomes an arm, and the traffic decides which argument your buyers
                were actually waiting for.
              </Body>
            </Rise>

            <Rise delay={80} className="mt-10">
              <Shelf
                ariaLabel="The four ad angles"
                itemClassName="w-[74%] sm:w-[48%] lg:w-[31.5%]"
                gap="md"
              >
                {ANGLES.map((angle) => (
                  <Surface
                    key={angle.n}
                    level="raised"
                    as="article"
                    className="flex h-full flex-col p-5 sm:p-6"
                  >
                    <Mono className="font-medium text-accent">{angle.n}</Mono>
                    <Title as="h3" className="mt-4 text-[1.5rem] tracking-[-0.02em]">
                      {angle.name}
                    </Title>
                    <Small className="mt-3 flex-1">{angle.body}</Small>
                    <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
                      <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                      <Mono className="min-w-0 text-muted">one arm on the bandit</Mono>
                    </div>
                  </Surface>
                ))}
              </Shelf>
            </Rise>
          </div>
        </section>

        <section className={`border-b border-border ${SECTION_PAD}`}>
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Eyebrow className="text-muted">How it works</Eyebrow>
              <Headline className="mt-4 max-w-2xl">
                Four moments, in order, and only the last one costs anything.
              </Headline>
            </Rise>

            <ol className="mt-12">
              {STEPS.map((step, i) => (
                <li key={step.n}>
                  <Rise delay={i * 70}>
                    <div className="grid gap-5 border-t border-border py-9 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8 sm:py-12">
                      <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-4">
                        <Mono className="font-medium text-accent">{step.n}</Mono>
                        <Surface
                          level="base"
                          className="flex size-12 shrink-0 items-center justify-center p-2.5 text-foreground sm:size-16 sm:p-3"
                        >
                          {step.glyph}
                        </Surface>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                          <Title
                            as="h3"
                            className="text-[clamp(1.25rem,2.6vw,1.75rem)] tracking-[-0.02em]"
                          >
                            {step.title}
                          </Title>
                          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[0.6875rem] text-muted">
                            {step.aside}
                          </span>
                        </div>
                        <Body className="mt-3 max-w-xl text-muted">{step.body}</Body>
                      </div>
                    </div>
                  </Rise>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={`border-b border-border ${SECTION_PAD}`}>
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Eyebrow className="text-muted">Measured, not claimed</Eyebrow>
              <Headline className="mt-4 max-w-3xl">
                Most agents ask you to trust them. This one publishes its error rate.
              </Headline>
            </Rise>

            <Rise delay={80}>
              <Surface level="feature" className="mt-10 p-6 sm:mt-14 sm:p-10">
                <Eyebrow className="text-muted">False winners called on two identical ads</Eyebrow>
                <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-10">
                  <BigNumber
                    className="min-w-0 sm:flex-1"
                    value={44.5}
                    decimals={1}
                    suffix="%"
                    label="Probability rule alone"
                    detail="Checked after every batch of traffic, which is what an agent actually does."
                  />
                  <div
                    aria-hidden
                    className="shrink-0 text-muted sm:self-center sm:pt-4"
                  >
                    <ArrowRight className="size-7 rotate-90 sm:rotate-0" />
                  </div>
                  <BigNumber
                    className="min-w-0 sm:flex-1"
                    value={0.5}
                    decimals={1}
                    suffix="%"
                    tone="accent"
                    label="The four gates"
                    detail="Same ads, same number of looks, same 200 runs against known truth."
                  />
                </div>
                <Body className="mt-10 max-w-2xl border-t border-border pt-6 text-muted">
                  A 95% probability of being best is not a 5% chance of being wrong. It is a
                  statement about one look at the data, and an agent that rechecks after every batch
                  of traffic is not taking one look. The{" "}
                  <Glossary term="four-gates">four gates</Glossary> add an effect size floor and an
                  anytime valid boundary, and the false alarms collapse. On four identical ads the
                  same comparison runs 8.5% down to 0.0%.
                </Body>
              </Surface>
            </Rise>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Rise delay={60}>
                <Surface level="raised" className="h-full p-6 sm:p-8">
                  <Eyebrow className="text-muted">And when it does fire</Eyebrow>
                  <BigNumber
                    className="mt-4"
                    value={100}
                    suffix="%"
                    tone="accent"
                    label="Correct ad, every time"
                    detail="The ad the gates point at is the truly best ad, across the same runs against known truth."
                  />
                </Surface>
              </Rise>

              <Rise delay={120}>
                <Surface level="raised" className="h-full p-6 sm:p-8">
                  <Eyebrow className="text-muted">How it was measured</Eyebrow>
                  <dl className="mt-5">
                    {METHOD.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-baseline justify-between gap-4 border-b border-border py-3.5 first:pt-0 last:border-b-0 last:pb-0"
                      >
                        <Small as="dt" className="min-w-0">
                          {item.label}
                        </Small>
                        <dd className="t-num shrink-0 font-mono text-base font-medium">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <Caption className="mt-5 text-muted">
                    Simulated against known truth, so a false winner is countable rather than
                    arguable. Reproducible with no API keys.
                  </Caption>
                  <code className="mt-2 block w-fit max-w-full overflow-x-auto whitespace-nowrap rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[0.75rem] text-foreground">
                    node scripts/bandit-test.mts
                  </code>
                </Surface>
              </Rise>
            </div>
          </div>
        </section>

        <section className={`border-b border-border ${SECTION_PAD}`}>
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Eyebrow className="text-muted">The limits you set</Eyebrow>
              <Headline className="mt-4 max-w-3xl">
                It spends without asking, and it cannot spend outside the mandate.
              </Headline>
              <Body className="mt-5 max-w-xl text-muted">
                A <Glossary term="mandate" /> is a signed permission, not a stored card. You sign it
                once with a passkey. Every charge after that is agent initiated, with nobody in the
                loop.
              </Body>
            </Rise>

            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {GUARDRAILS.map((g, i) => (
                <Rise key={g.label} delay={i * 60}>
                  <Surface level="quiet" className="h-full p-5">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                      <p className="min-w-0 text-[0.9375rem] font-semibold tracking-tight">
                        {g.label}
                      </p>
                    </div>
                    <Caption className="mt-2.5 text-muted">{g.detail}</Caption>
                  </Surface>
                </Rise>
              ))}
            </div>

            <Rise delay={140}>
              <Surface level="base" className="mt-4 grid gap-6 p-6 sm:grid-cols-2 sm:gap-10 sm:p-8">
                <div className="min-w-0">
                  <Eyebrow className="text-muted">Over the ceiling</Eyebrow>
                  <Small className="mt-3">
                    The over cap charge is not blocked by our code. It is sent, the card network
                    refuses it, and the decline comes back with a reason a seller can act on.
                    Nothing is spent and the mandate stays live.
                  </Small>
                </div>
                <div className="min-w-0">
                  <Eyebrow className="text-muted">The card number</Eyebrow>
                  <Small className="mt-3">
                    Never touches the agent. Each charge mints a single use credential, and the
                    dashboard shows which one was burned on what.
                  </Small>
                </div>
              </Surface>
            </Rise>
          </div>
        </section>

        <section className="pb-20 pt-20 sm:pb-24 sm:pt-28">
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Surface level="feature" className="mx-auto max-w-2xl p-8 text-center sm:p-14">
                <Eyebrow className="text-muted">Your turn</Eyebrow>
                <Headline className="mt-4">Give it a product and watch it decide.</Headline>
                <Body className="mx-auto mt-5 max-w-md text-muted">
                  The whole run takes a few minutes. You can watch the beliefs narrow and the gates
                  disagree while it happens.
                </Body>
                <a
                  href="#start"
                  className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground mt-8 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-6 py-3.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 sm:w-auto"
                >
                  Start a run
                  <ArrowRight className="size-4" />
                </a>
              </Surface>
            </Rise>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-gutter py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0">Built at the Agentic Commerce Hackathon, 2026.</span>
          <span className="min-w-0 font-mono">OpenAI and Prava on Visa Intelligent Commerce</span>
        </div>
      </footer>
    </div>
  );
}
