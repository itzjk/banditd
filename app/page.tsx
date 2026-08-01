"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { State } from "@/lib/store";
import Glossary from "@/components/Glossary";

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

const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

const HEADING_XL = "text-[clamp(2.375rem,7.2vw,4.75rem)] leading-[1.02] tracking-[-0.035em]";
const HEADING_LG = "text-[clamp(1.75rem,4.1vw,2.875rem)] leading-[1.06] tracking-[-0.03em]";
const NUMBER_XL =
  "text-[clamp(3rem,8.6vw,5.5rem)] font-semibold leading-[0.92] tracking-[-0.04em] tabular-nums";

type RevealCallback = () => void;

let sharedObserver: IntersectionObserver | null = null;
const revealTargets = new WeakMap<Element, RevealCallback>();

function getRevealObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver !== "function") return null;
  if (sharedObserver) return sharedObserver;
  sharedObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const fire = revealTargets.get(entry.target);
        revealTargets.delete(entry.target);
        observer.unobserve(entry.target);
        fire?.();
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0 },
  );
  return sharedObserver;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  distance?: number;
}

function Reveal({ children, delay = 0, className, distance = 16 }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;
    const observer = prefersReducedMotion() ? null : getRevealObserver();
    if (!observer) {
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    revealTargets.set(node, () => setShown(true));
    observer.observe(node);
    return () => {
      revealTargets.delete(node);
      observer.unobserve(node);
    };
  }, [shown]);

  const style: CSSProperties = shown
    ? {
        opacity: 1,
        transform: "none",
        transition: `opacity 380ms ${EASE} ${delay}ms, transform 380ms ${EASE} ${delay}ms`,
      }
    : {
        opacity: 0,
        transform: `translate3d(0, ${distance}px, 0)`,
        willChange: "opacity, transform",
      };

  return (
    <div ref={ref} data-reveal={shown ? "in" : "out"} className={className} style={style}>
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

function Arrow({ className }: { className?: string }) {
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

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" className={className}>
      <path
        d="m9.5 5 7 7-7 7"
        stroke="currentColor"
        strokeWidth="1.8"
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

function CornerTicks() {
  const corner = "pointer-events-none absolute size-2.5 border-border-strong";
  return (
    <>
      <span aria-hidden className={`${corner} left-2 top-2 border-l border-t`} />
      <span aria-hidden className={`${corner} right-2 top-2 border-r border-t`} />
      <span aria-hidden className={`${corner} bottom-2 left-2 border-b border-l`} />
      <span aria-hidden className={`${corner} bottom-2 right-2 border-b border-r`} />
    </>
  );
}

function HeroVisualInner() {
  return <div className="h-44 w-full rounded-lg border border-dashed border-border sm:h-52" />;
}

function HeroVisual() {
  return (
    <figure className="card relative overflow-hidden">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-foreground/10"
      />
      <CornerTicks />
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
        <span className="eyebrow min-w-0">Four beliefs, narrowing</span>
        <span className="min-w-0 font-mono text-[0.6875rem] text-subtle">simulated traffic</span>
      </figcaption>
      <div className="px-4 py-5 sm:px-5 sm:py-6">
        <HeroVisualInner />
      </div>
    </figure>
  );
}

const ANGLES: { n: string; name: string; body: string }[] = [
  {
    n: "01",
    name: "Price",
    body: "Cost per cup against the café you were going to walk into anyway. The argument is arithmetic, and it is checkable.",
  },
  {
    n: "02",
    name: "Ritual",
    body: "The morning it belongs to. Sold as a habit you already have, not as a bottle you do not.",
  },
  {
    n: "03",
    name: "Gift",
    body: "Who you would hand it to, and why it still reads as considered once it is wrapped.",
  },
  {
    n: "04",
    name: "Quality",
    body: "What eighteen hours of cold steeping does to a bean that hot water never gets to.",
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

function ShelfButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-border disabled:hover:text-muted"
    >
      {children}
    </button>
  );
}

function AnglesSection() {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setAtStart(node.scrollLeft <= 2);
    setAtEnd(max <= 2 || node.scrollLeft >= max - 2);
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const frame = requestAnimationFrame(sync);
    node.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  const nudge = useCallback((direction: 1 | -1) => {
    const node = scroller.current;
    if (!node) return;
    node.scrollBy({
      left: direction * Math.max(240, node.clientWidth * 0.78),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  return (
    <section className="border-b border-border py-20 sm:py-28 lg:py-32">
      <div className="mx-auto w-full max-w-5xl px-gutter">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0 max-w-2xl">
              <p className="eyebrow">What it makes</p>
              <h2 className={`mt-4 text-balance font-semibold ${HEADING_LG}`}>
                Four arguments, not four rewordings of one.
              </h2>
              <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-muted sm:text-base">
                The creative schema names the angle, so the four ads have to disagree with each
                other. Each one becomes an arm, and the traffic decides which argument your buyers
                were actually waiting for.
              </p>
            </div>
            <div className="hidden shrink-0 gap-2 sm:flex">
              <ShelfButton label="Previous angles" disabled={atStart} onClick={() => nudge(-1)}>
                <Chevron className="size-4 rotate-180" />
              </ShelfButton>
              <ShelfButton label="Next angles" disabled={atEnd} onClick={() => nudge(1)}>
                <Chevron className="size-4" />
              </ShelfButton>
            </div>
          </div>
        </Reveal>

        <Reveal delay={60}>
          <div
            ref={scroller}
            className="-mx-gutter mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-pl-gutter px-gutter pb-3 [scrollbar-width:none] sm:gap-5"
          >
            {ANGLES.map((angle) => (
              <article
                key={angle.n}
                className="card relative flex w-[74vw] max-w-[19rem] shrink-0 snap-start flex-col p-5 sm:w-[19rem] sm:p-6 lg:w-[20rem]"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[0.875rem] bg-foreground/10"
                />
                <span className="font-mono text-xs font-medium tabular-nums text-accent">
                  {angle.n}
                </span>
                <h3 className="mt-4 text-2xl font-semibold tracking-tight">{angle.name}</h3>
                <p className="mt-3 flex-1 text-pretty text-sm leading-relaxed text-muted">
                  {angle.body}
                </p>
                <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
                  <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="min-w-0 font-mono text-[0.6875rem] text-subtle">
                    one arm on the bandit
                  </span>
                </div>
              </article>
            ))}
            <div aria-hidden className="w-px shrink-0" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

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
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-gutter py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Mark className="size-5 shrink-0 text-foreground" />
            <span className="truncate text-[0.9375rem] font-semibold tracking-tight">banditd</span>
            <span className="hidden text-sm text-subtle sm:inline">ad agent</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted md:inline-flex">
              <span className="size-1.5 rounded-full bg-accent" />
              Prava sandbox
            </span>
            <a
              href="#start"
              className="rounded-lg bg-foreground px-3.5 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90"
            >
              Start a run
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="grid-bg relative border-b border-border">
          <div className="mx-auto w-full max-w-5xl px-gutter pb-16 pt-14 sm:pb-24 sm:pt-24 lg:pb-28 lg:pt-28">
            <div className="enter max-w-4xl">
              <p className="eyebrow">Agentic commerce</p>
              <h1 className={`mt-4 text-balance font-semibold ${HEADING_XL}`}>
                An agent that runs your ads and spends its own money on the ones that work.
              </h1>
              <p className="mt-6 max-w-2xl text-pretty text-[clamp(1rem,1.7vw,1.25rem)] leading-relaxed text-muted">
                Give it a product. It researches the market, writes the ads, watches which one
                actually wins, and once the evidence is statistical it buys more render credits by
                itself through Prava, inside the limits you set.
              </p>
            </div>

            <dl
              className="enter mt-9 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-6 sm:mt-12"
              style={{ animationDelay: "80ms" }}
            >
              {HERO_STATS.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <dd className="text-[clamp(1.5rem,3vw,2rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                    {stat.value}
                  </dd>
                  <dt className="eyebrow mt-2">{stat.label}</dt>
                </div>
              ))}
            </dl>

            <div className="mt-10 grid items-start gap-6 sm:mt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-10">
              <div className="enter order-2 min-w-0 lg:order-1" style={{ animationDelay: "200ms" }}>
                <HeroVisual />
              </div>

              <div
                className="enter relative order-1 min-w-0 lg:order-2"
                style={{ animationDelay: "120ms" }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-5 -bottom-2 h-8 rounded-b-[0.875rem] border border-border bg-surface-2"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-2.5 -bottom-1 h-8 rounded-b-[0.875rem] border border-border bg-surface"
                />
                <div id="start" className="card relative scroll-mt-24 p-5 sm:p-6">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[0.875rem] bg-foreground/10"
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold tracking-tight">
                        Start with a product
                      </h2>
                      <p className="mt-1 text-sm text-muted">Name, price, one line about it.</p>
                    </div>
                    <button
                      type="button"
                      onClick={fillExample}
                      className="shrink-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
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
                      className="w-full rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy ? "Handing it to the agent" : "Hand it to the agent"}
                    </button>

                    <p className="text-[0.8125rem] leading-relaxed text-muted">
                      Performance numbers in the demo are simulated and labeled in the dashboard.
                      Payments run against the Prava sandbox.
                    </p>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </section>

        <AnglesSection />

        <section className="border-b border-border py-20 sm:py-28 lg:py-32">
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Reveal>
              <p className="eyebrow">How it works</p>
              <h2 className={`mt-4 max-w-2xl text-balance font-semibold ${HEADING_LG}`}>
                Four moments, in order, and only the last one costs anything.
              </h2>
            </Reveal>

            <ol className="mt-12">
              {STEPS.map((step, i) => (
                <li key={step.n}>
                  <Reveal delay={i * 60}>
                    <div className="grid gap-5 border-t border-border py-9 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8 sm:py-12">
                      <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-4">
                        <span className="font-mono text-xs font-medium tabular-nums text-accent">
                          {step.n}
                        </span>
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-surface p-2.5 text-foreground shadow-card sm:size-16 sm:p-3">
                          {step.glyph}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                          <h3 className="text-balance text-[clamp(1.25rem,2.6vw,1.75rem)] font-semibold tracking-[-0.02em]">
                            {step.title}
                          </h3>
                          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[0.6875rem] text-subtle">
                            {step.aside}
                          </span>
                        </div>
                        <p className="mt-3 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-muted sm:text-base">
                          {step.body}
                        </p>
                      </div>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="grid-bg border-b border-border py-20 sm:py-28 lg:py-36">
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Reveal>
              <p className="eyebrow">Measured, not claimed</p>
              <h2 className={`mt-4 max-w-3xl text-balance font-semibold ${HEADING_LG}`}>
                Most agents ask you to trust them. This one publishes its error rate.
              </h2>
            </Reveal>

            <Reveal delay={60}>
              <div className="card relative mt-10 p-6 sm:mt-14 sm:p-10">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-foreground/10"
                />
                <p className="eyebrow">False winners called on two identical ads</p>
                <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-10">
                  <div className="min-w-0">
                    <p className={`${NUMBER_XL} text-danger`}>44.5%</p>
                    <p className="mt-3 max-w-[16rem] text-pretty text-sm leading-relaxed text-muted">
                      Probability rule alone, checked after every batch of traffic.
                    </p>
                  </div>
                  <div className="shrink-0 self-start pt-2 text-subtle sm:self-center sm:pb-16 sm:pt-0">
                    <Arrow className="size-7 rotate-90 sm:rotate-0" />
                  </div>
                  <div className="min-w-0">
                    <p className={`${NUMBER_XL} text-accent`}>0.5%</p>
                    <p className="mt-3 max-w-[16rem] text-pretty text-sm leading-relaxed text-muted">
                      The four gates, same ads, same number of looks.
                    </p>
                  </div>
                </div>
                <p className="mt-8 max-w-2xl border-t border-border pt-6 text-pretty text-sm leading-relaxed text-muted sm:text-[0.9375rem]">
                  A 95% probability of being best is not a 5% chance of being wrong. It is a
                  statement about one look at the data, and an agent that rechecks after every batch
                  of traffic is not taking one look. The{" "}
                  <Glossary term="four-gates">four gates</Glossary> add an effect size floor and an
                  anytime valid boundary, and the false alarms collapse. On four identical ads the
                  same comparison runs 8.5% down to 0.0%.
                </p>
              </div>
            </Reveal>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Reveal delay={80}>
                <div className="card h-full p-6 sm:p-8">
                  <p className="eyebrow">And when it does fire</p>
                  <p className={`mt-4 ${NUMBER_XL} text-accent`}>100%</p>
                  <p className="mt-4 max-w-sm text-pretty text-sm leading-relaxed text-muted sm:text-[0.9375rem]">
                    The ad the gates point at is the truly best ad. Every time, across the same runs
                    against known truth.
                  </p>
                </div>
              </Reveal>

              <Reveal delay={120}>
                <div className="card h-full p-6 sm:p-8">
                  <p className="eyebrow">How it was measured</p>
                  <dl className="mt-5 space-y-4">
                    {METHOD.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-baseline justify-between gap-4 border-b border-border pb-4 last:border-b-0 last:pb-0"
                      >
                        <dt className="min-w-0 text-sm text-muted">{item.label}</dt>
                        <dd className="shrink-0 font-mono text-base font-medium tabular-nums">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-5 text-pretty text-[0.8125rem] leading-relaxed text-subtle">
                    Simulated against known truth, so a false winner is countable rather than
                    arguable. Reproducible with no API keys:{" "}
                    <code className="break-words rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-foreground">
                      node scripts/bandit-test.mts
                    </code>
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="border-b border-border py-20 sm:py-28 lg:py-32">
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Reveal>
              <p className="eyebrow">The limits you set</p>
              <h2 className={`mt-4 max-w-3xl text-balance font-semibold ${HEADING_LG}`}>
                It spends without asking, and it cannot spend outside the mandate.
              </h2>
              <p className="mt-5 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-muted sm:text-base">
                A <Glossary term="mandate" /> is a signed permission, not a stored card. You sign it
                once with a passkey. Every charge after that is agent initiated, with nobody in the
                loop.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {GUARDRAILS.map((g, i) => (
                <Reveal key={g.label} delay={i * 50} className="bg-surface">
                  <div className="h-full p-5 sm:p-6">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                      <p className="min-w-0 text-[0.9375rem] font-semibold tracking-tight">
                        {g.label}
                      </p>
                    </div>
                    <p className="mt-2.5 text-pretty text-[0.8125rem] leading-relaxed text-muted">
                      {g.detail}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={120}>
              <div className="mt-4 grid gap-6 rounded-2xl border border-border bg-surface-2 p-6 sm:grid-cols-2 sm:gap-10 sm:p-8">
                <div className="min-w-0">
                  <p className="eyebrow">Over the ceiling</p>
                  <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
                    The over cap charge is not blocked by our code. It is sent, the card network
                    refuses it, and the decline comes back with a reason a seller can act on.
                    Nothing is spent and the mandate stays live.
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="eyebrow">The card number</p>
                  <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
                    Never touches the agent. Each charge mints a single use credential, and the
                    dashboard shows which one was burned on what.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="grid-bg pb-24 pt-20 sm:pb-32 sm:pt-28">
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Reveal>
              <div className="card relative mx-auto max-w-2xl p-8 text-center sm:p-14">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[0.875rem] bg-foreground/10"
                />
                <p className="eyebrow">Your turn</p>
                <h2 className={`mt-4 text-balance font-semibold ${HEADING_LG}`}>
                  Give it a product and watch it decide.
                </h2>
                <p className="mx-auto mt-5 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-muted">
                  The whole run takes a few minutes. You can watch the beliefs narrow and the gates
                  disagree while it happens.
                </p>
                <a
                  href="#start"
                  className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-6 py-3.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 sm:w-auto"
                >
                  Start a run
                  <Arrow className="size-4" />
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-gutter py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0">Built at the Agentic Commerce Hackathon, 2026.</span>
          <span className="min-w-0 font-mono">OpenAI and Prava on Visa Intelligent Commerce</span>
        </div>
      </footer>
    </div>
  );
}
