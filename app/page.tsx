"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { State } from "@/lib/store";
import { archiveRun } from "@/lib/history";
import { searchCatalog, type CatalogProduct } from "@/lib/catalog";
import Glossary from "@/components/Glossary";
import ProofLab from "@/components/ProofLab";
import {
  BanditLearning,
  BigNumber,
  Body,
  BudgetShift,
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
const IMAGES_KEY = "banditd_images";
const MARKET_CONTEXT_MAX = 500;
const MARKET_LINKS_MAX = 4;

interface SavedRun {
  creatives: number;
  purchases: number;
}

function subscribeSaved(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function readSaved(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function savedRun(raw: string | null): SavedRun | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { creatives?: unknown; purchases?: unknown };
    const creatives = Array.isArray(parsed?.creatives) ? parsed.creatives.length : 0;
    const purchases = Array.isArray(parsed?.purchases) ? parsed.purchases.length : 0;
    if (creatives === 0 && purchases === 0) return null;
    return { creatives, purchases };
  } catch {
    return null;
  }
}

function dropImages() {
  try {
    window.localStorage.removeItem(IMAGES_KEY);
  } catch {
    return;
  }
}

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
const SECTION_PAD = "py-14 sm:py-24 lg:py-32";
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

const DIFFERENCE: { label: string; title: string; body: string }[] = [
  {
    label: "An ad generator",
    title: "Gives you four ads and stops.",
    body: "You still have to guess which one is working, how long to wait before calling it, and how much of the budget it has already eaten while you waited.",
  },
  {
    label: "banditd",
    title: "Decides which ad gets switched off, and when.",
    body: "It reads the traffic, holds the call until the evidence clears four gates, names the ad that lost, and pays for the next round of work itself.",
  },
];

const REASONING_ARMS: { label: string; angle: string; ctr: string; lead: boolean }[] = [
  { label: "A", angle: "Price", ctr: "5.3%", lead: true },
  { label: "B", angle: "Ritual", ctr: "2.1%", lead: false },
  { label: "C", angle: "Gift", ctr: "1.8%", lead: false },
  { label: "D", angle: "Quality", ctr: "2.4%", lead: false },
];

const GUARDRAILS: { label: string; detail: string }[] = [
  { label: "Max spend", detail: "A ceiling the card network itself refuses to cross." },
  { label: "Allowed merchant", detail: "One listed merchant, and nothing else." },
  { label: "Expiry date", detail: "The permission runs out on its own." },
  { label: "Revocable anytime", detail: "One tap and the agent has nothing left to charge." },
];

const BUYER: { label: string; detail: string }[] = [
  {
    label: "Sells online",
    detail:
      "One store, one catalog, and paid traffic is the main way it grows. Not an agency, not a brand team.",
  },
  {
    label: "Spends $10,000 to $250,000 a month on ads",
    detail:
      "Enough that a losing creative is a number you feel. Below that, testing is cheap enough to guess at.",
  },
  {
    label: "Has no data team",
    detail:
      "Nobody on staff can tell you whether a test has run long enough, so the call gets made on a hunch and a dashboard.",
  },
  {
    label: "Ships new creative every week",
    detail:
      "The ads that lose cost exactly as much as the ads that win, and you only find out which was which afterwards.",
  },
];

const REFUSALS: { code: string; attempt: string; said: string }[] = [
  {
    code: "THRESHOLD_EXCEEDED",
    attempt: "The agent asked for $50.00 against a mandate the seller signed at $5.00.",
    said: "Visa did not return COMPLETED (status DECLINED): Total amount 50.00 exceeds threshold 5.00 in current payment cycle",
  },
  {
    code: "MANDATE_MERCHANT_NOT_ALLOWED",
    attempt: "The agent tried to buy render credits on a mandate the seller signed for Allbirds.",
    said: "Merchant not allowed for this mandate: Banditd Render Credits",
  },
];

const LIMITS: { label: string; detail: string }[] = [
  {
    label: "The ad circuit is simulated",
    detail:
      "There is no Meta or Google integration. Impressions and clicks come from a simulator, and every figure it produces is labeled as simulated in the dashboard. The payment circuit is the real half: a signed mandate, an agent initiated charge, and a decline that comes from the card network.",
  },
  {
    label: "It decides on clicks, not on sales",
    detail:
      "Click through rate is an imperfect stand in for a purchase. The maths does not care which event it counts, a posterior over purchases works exactly like a posterior over clicks, but the standard of the trade is around 50 conversion events per variant. On conversions the same engine needs a lot more traffic before it will call anything.",
  },
];

const HERO_STATS: { value: string; label: string }[] = [
  { value: "44.5%", label: "false winners, naive rule" },
  { value: "2.5%", label: "false winners, four gates" },
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
  const [marketContext, setMarketContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [estimated, setEstimated] = useState(false);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const storedRun = useSyncExternalStore(subscribeSaved, readSaved, () => null);
  const saved = useMemo(() => savedRun(storedRun), [storedRun]);
  const matches = useMemo(() => (suggestOpen ? searchCatalog(name) : []), [suggestOpen, name]);
  const listOpen = suggestOpen && matches.length > 0;

  useEffect(() => {
    if (!listOpen) return;
    function onPointerDown(event: PointerEvent) {
      const node = comboRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        setSuggestOpen(false);
        setActiveSuggestion(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [listOpen]);

  useEffect(() => {
    if (!listOpen || activeSuggestion < 0) return;
    const option = document.getElementById(`product-suggestion-${activeSuggestion}`);
    option?.scrollIntoView({ block: "nearest" });
  }, [listOpen, activeSuggestion]);

  function pickSuggestion(item: CatalogProduct) {
    setName(item.name);
    setPrice(item.price);
    setDescription(item.description);
    setEstimated(true);
    setSuggestOpen(false);
    setActiveSuggestion(-1);
    setError(null);
  }

  function onNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (!listOpen) return;
      e.preventDefault();
      setSuggestOpen(false);
      setActiveSuggestion(-1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!listOpen) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const count = matches.length;
      setActiveSuggestion((current) => {
        if (current < 0) return step === 1 ? 0 : count - 1;
        return (current + step + count) % count;
      });
      return;
    }
    if (e.key === "Enter" && listOpen && activeSuggestion >= 0) {
      e.preventDefault();
      pickSuggestion(matches[activeSuggestion]);
      return;
    }
    if (e.key === "Tab" && listOpen) {
      setSuggestOpen(false);
      setActiveSuggestion(-1);
    }
  }

  function fillExample() {
    setName(EXAMPLE.name);
    setPrice(EXAMPLE.price);
    setDescription(EXAMPLE.description);
    setEstimated(false);
    setSuggestOpen(false);
    setActiveSuggestion(-1);
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
        body: JSON.stringify({ name, price, description, marketContext }),
      });
      const data = (await res.json().catch(() => null)) as (State & { error?: string }) | null;
      if (!res.ok) {
        setError(data?.error ?? "Could not save the product. Try again.");
        setBusy(false);
        return;
      }
      archiveRun(readSaved());
      dropImages();
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
            <span className="hidden items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted lg:inline-flex">
              <span className="size-1.5 rounded-full bg-accent" />
              Prava sandbox
            </span>
            <Link
              href="/dashboard"
              className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground hover-tint inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3.5 text-[0.8125rem] font-semibold text-foreground hover:border-border-strong"
            >
              Open the dashboard
            </Link>
            <a
              href="#start"
              className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground inline-flex min-h-11 items-center rounded-lg bg-foreground px-4 text-[0.8125rem] font-semibold text-background transition-opacity hover:opacity-90"
            >
              Start a run
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        <section className="relative overflow-hidden border-b border-border">
          <MeshField variant="flow" intensity="soft" parallax position="absolute" />
          <div className="relative mx-auto w-full max-w-5xl px-gutter pb-16 pt-12 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-16">
            <div className="enter max-w-4xl">
              <Eyebrow className="text-muted">The expensive call is when to stop</Eyebrow>
              <span className="mt-2 flex items-center gap-1.5 text-[0.8125rem] text-muted lg:hidden">
                <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                Prava sandbox, no real money moves
              </span>
              <Display className={`mt-4 ${DISPLAY_XL}`}>
                Stop paying for the ads that lost. banditd decides which one to switch off, and
                when.
              </Display>
              <Lead className="mt-5 max-w-2xl">
                Hand it a product. It writes four different ads, puts them in front of traffic, and
                holds the call until the evidence is good enough to act on. Then it pays for the
                next round of work itself, inside the limits you set.
              </Lead>
              <Caption className="mt-5 max-w-xl text-muted">
                The rule most agents use calls a false winner 44.5% of the time. This one calls a
                false winner 2.5% of the time, on the same runs against known truth, and the script
                that proves it runs on your laptop in three and a half minutes with no keys.
              </Caption>
            </div>

            <div className="mt-8 grid items-start gap-6 sm:mt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] lg:gap-10">
              <div className="enter order-2 min-w-0 lg:order-1" style={{ animationDelay: "200ms" }}>
                <Surface level="raised" className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
                    <Eyebrow as="span" className="min-w-0 text-muted">
                      What the decision looks like
                    </Eyebrow>
                    <Mono className="min-w-0 text-muted">illustration</Mono>
                  </div>
                  <div className="px-4 py-5 sm:px-5 sm:py-6">
                    <BudgetShift
                      title="A hundred dollar test budget starts split evenly across four ads. Traffic arrives, one ad draws clicks ahead of the rest, and once the gates agree the three that lost are held back to a tenth of the test each."
                      startNote="Started at an even 25 / 25 / 25 / 25 split. Traffic put one ad ahead, the gates agreed, and the other three were held back to a tenth of the test each."
                    />
                  </div>
                </Surface>
              </div>

              <div className="enter order-1 min-w-0 lg:order-2" style={{ animationDelay: "120ms" }}>
                <Surface level="feature" id="start" className="scroll-mt-20 p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Title as="h2">Start with a product</Title>
                      <Small className="mt-1">Name, price, one line about it.</Small>
                    </div>
                    <button
                      type="button"
                      onClick={fillExample}
                      className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground hover-tint inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border bg-surface-2 px-3.5 text-[0.8125rem] font-medium text-muted hover:border-border-strong hover:text-foreground"
                    >
                      Use example
                    </button>
                  </div>

                  <form onSubmit={onSubmit} className="mt-5 space-y-4">
                    <div ref={comboRef} className="relative">
                      <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                        Product name
                      </label>
                      <input
                        id="name"
                        name="name"
                        className="field"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          setSuggestOpen(true);
                          setActiveSuggestion(-1);
                          setEstimated(false);
                        }}
                        onKeyDown={onNameKeyDown}
                        onFocus={() => setSuggestOpen(true)}
                        placeholder="Start typing, try air"
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={listOpen}
                        aria-controls="product-suggestions"
                        aria-autocomplete="list"
                        aria-activedescendant={
                          listOpen && activeSuggestion >= 0
                            ? `product-suggestion-${activeSuggestion}`
                            : undefined
                        }
                        required
                      />
                      <ul
                        id="product-suggestions"
                        role="listbox"
                        aria-label="Product suggestions"
                        hidden={!listOpen}
                        className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[13.5rem] overflow-y-auto overscroll-contain rounded-lg border border-border-strong bg-surface py-1 shadow-panel sm:max-h-[21rem]"
                      >
                        {matches.map((item, index) => (
                          <li
                            key={item.name}
                            id={`product-suggestion-${index}`}
                            role="option"
                            aria-selected={index === activeSuggestion}
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => pickSuggestion(item)}
                            onMouseMove={() => setActiveSuggestion(index)}
                            className={`cursor-pointer px-3 py-2.5 ${
                              index === activeSuggestion ? "bg-surface-2" : ""
                            }`}
                          >
                            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                              <span className="min-w-0 text-sm font-medium text-foreground">
                                {item.name}
                              </span>
                              <span className="t-num shrink-0 text-[0.8125rem] text-muted">
                                {item.price}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[0.8125rem] leading-snug text-muted">
                              {item.description}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p aria-live="polite" className="sr-only">
                        {listOpen
                          ? `${matches.length} ${matches.length === 1 ? "suggestion" : "suggestions"} available`
                          : ""}
                      </p>
                    </div>

                    <div>
                      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <label htmlFor="price" className="block text-sm font-medium">
                          Price
                        </label>
                        {estimated ? (
                          <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted">
                            Estimate
                          </span>
                        ) : null}
                      </div>
                      <input
                        id="price"
                        name="price"
                        className="field"
                        value={price}
                        onChange={(e) => {
                          setPrice(e.target.value);
                          setEstimated(false);
                        }}
                        placeholder="$28.00"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-describedby={estimated ? "price-estimate-note" : undefined}
                        required
                      />
                      {estimated ? (
                        <Small id="price-estimate-note" className="mt-1.5 block">
                          Estimated from a typical listing, not a live quote. Edit it to your real
                          price.
                        </Small>
                      ) : null}
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

                    <div>
                      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <label htmlFor="marketContext" className="block text-sm font-medium">
                          Anything the agent should know about your market
                        </label>
                        <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted">
                          Optional
                        </span>
                      </div>
                      <textarea
                        id="marketContext"
                        name="marketContext"
                        className="field resize-none"
                        rows={3}
                        value={marketContext}
                        maxLength={MARKET_CONTEXT_MAX}
                        onChange={(e) => setMarketContext(e.target.value)}
                        placeholder="I sell on Facebook Marketplace in Colombia and buyers message me before they buy. Look at https://example.com/rival-listing"
                        aria-describedby="market-context-help"
                      />
                      <Small id="market-context-help" className="mt-1.5 block">
                        Where you sell, who buys, who you compete against. Paste links and the
                        research reads them, your own store, a rival listing, a study you trust. Up
                        to {MARKET_LINKS_MAX} links, {MARKET_CONTEXT_MAX} characters. The agent
                        treats it as context about your market, never as orders it follows.
                      </Small>
                      {marketContext.length >= MARKET_CONTEXT_MAX - 100 ? (
                        <Small aria-live="polite" className="mt-1 block t-num">
                          {marketContext.length} of {MARKET_CONTEXT_MAX} characters
                        </Small>
                      ) : null}
                    </div>

                    {error ? (
                      <p
                        role="alert"
                        className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                      >
                        {error}
                      </p>
                    ) : null}

                    {saved ? (
                      <div className="rounded-lg border border-border bg-surface-2 px-3 py-3">
                        <p className="text-sm font-semibold text-foreground">
                          A run is already saved in this browser
                        </p>
                        <Small className="mt-1.5 block text-muted">
                          {saved.creatives} {saved.creatives === 1 ? "ad" : "ads"} and{" "}
                          {saved.purchases} {saved.purchases === 1 ? "charge" : "charges"}. Handing
                          over a new product files that run in the history and starts the board
                          fresh. Nothing is lost, and the dashboard can open it again or set it
                          beside the new one.
                        </Small>
                        <Link
                          href="/dashboard"
                          className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground mt-2.5 inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3.5 text-[0.8125rem] font-semibold text-foreground hover:border-border-strong"
                        >
                          Open that run instead
                        </Link>
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      disabled={busy}
                      className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground min-h-[3.25rem] w-full rounded-lg bg-foreground px-4 text-[0.9375rem] font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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

            <dl
              className="enter mt-10 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-6 sm:mt-12"
              style={{ animationDelay: "260ms" }}
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
          </div>
        </section>

        <section className={`border-b border-border ${SECTION_PAD}`}>
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Eyebrow className="text-muted">What makes it different</Eyebrow>
              <Headline className="mt-4 max-w-3xl">
                Plenty of tools write ads. This one decides which ad stops.
              </Headline>
              <Body className="mt-5 max-w-2xl text-muted">
                A generator hands you four files and leaves you the expensive part, which one you
                should stop paying for and when that answer can be trusted. That is the part
                banditd does, and it publishes how often it gets that call wrong.
              </Body>
            </Rise>

            <div className="mt-10 grid gap-4 lg:grid-cols-2">
              {DIFFERENCE.map((item, i) => (
                <Rise key={item.label} delay={i * 70}>
                  <Surface
                    level={i === 1 ? "feature" : "quiet"}
                    className="h-full p-6 sm:p-8"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${i === 1 ? "bg-accent" : "bg-border-strong"}`}
                      />
                      <Eyebrow as="span" className="min-w-0 text-muted">
                        {item.label}
                      </Eyebrow>
                    </div>
                    <Title as="h3" className="mt-4 text-[clamp(1.25rem,2.6vw,1.625rem)]">
                      {item.title}
                    </Title>
                    <Small className="mt-3 text-muted">{item.body}</Small>
                  </Surface>
                </Rise>
              ))}
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

            <ol className="mt-8 sm:mt-12">
              {STEPS.map((step, i) => (
                <li key={step.n}>
                  <Rise delay={i * 70}>
                    <div className="grid gap-4 border-t border-border py-7 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8 sm:py-12">
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

            <Rise delay={80}>
              <Surface level="raised" className="mt-4 overflow-hidden">
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
            </Rise>
          </div>
        </section>

        <section className={`border-b border-border ${SECTION_PAD}`}>
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Eyebrow className="text-muted">The reasoning, in the open</Eyebrow>
              <Headline className="mt-4 max-w-3xl">
                You can read the decision before the money moves.
              </Headline>
              <Body className="mt-5 max-w-2xl text-muted">
                Every charge the agent makes carries one plain sentence naming the winning ad, the
                probability behind it, and the traffic it was measured on. Your run writes its own.
                This is the shape of it.
              </Body>
            </Rise>

            <Rise delay={80}>
              <Surface level="feature" className="mt-10 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3.5 sm:px-7">
                  <Eyebrow as="span" className="min-w-0 text-muted">
                    Example decision
                  </Eyebrow>
                  <Mono className="min-w-0 text-muted">not from a live run</Mono>
                </div>

                <div className="px-5 py-6 sm:px-7 sm:py-8">
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {REASONING_ARMS.map((arm) => (
                      <div
                        key={arm.label}
                        className="flex items-baseline justify-between gap-4 border-b border-border py-2.5"
                      >
                        <dt className="flex min-w-0 items-baseline gap-2">
                          <Mono
                            className={`font-medium ${arm.lead ? "text-accent" : "text-muted"}`}
                          >
                            {arm.label}
                          </Mono>
                          <span className="min-w-0 truncate text-sm text-muted">{arm.angle}</span>
                        </dt>
                        <dd
                          className={`shrink-0 font-mono text-sm tabular-nums ${arm.lead ? "font-semibold text-accent" : "text-muted"}`}
                        >
                          CTR {arm.ctr}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
                    <Mono className="text-muted">probability A is best 96.4%</Mono>
                    <Mono className="text-muted">1,840 impressions</Mono>
                    <Mono className="text-muted">gates 4 of 4</Mono>
                  </div>

                  <div className="mt-6 border-t border-border pt-6">
                    <Eyebrow className="text-muted">What it does about it</Eyebrow>
                    <Body className="mt-3 max-w-2xl">
                      Traffic share moves to A, 70%, and the other three hold at 10% while they stay
                      in the test. It charges $4.00 for another pack of render credits to make more
                      variants of A.
                    </Body>
                    <blockquote className="mt-5 border-l-2 border-accent pl-4 text-[0.9375rem] leading-relaxed text-muted">
                      &ldquo;Variant A, the price angle, leads with 5.3% CTR against 2.4% for the
                      next best, and it is best with 96.4% probability across 1,840 impressions, so
                      I am buying more render credits to build on it.&rdquo;
                    </blockquote>
                    <Caption className="mt-4 text-muted">
                      Written in the shape the model returns on a real run. The numbers here are an
                      example, the dashboard shows the sentence and the figures from your own run.
                    </Caption>
                  </div>
                </div>
              </Surface>
            </Rise>
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
                    countUp={false}
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
                    countUp={false}
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

            <Rise delay={140} className="mt-4">
              <ProofLab folded batchSize={200} />
            </Rise>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Rise delay={60}>
                <Surface level="raised" className="h-full p-6 sm:p-8">
                  <Eyebrow className="text-muted">And when it does fire</Eyebrow>
                  <BigNumber
                    className="mt-4"
                    value={100}
                    suffix="%"
                    countUp={false}
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
                        <dd className="t-num min-w-0 text-right font-mono text-base font-medium">
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
              <Eyebrow className="text-muted">Why you can trust it with money</Eyebrow>
              <Headline className="mt-4 max-w-3xl">
                Four limits it cannot cross, and a card number it never sees.
              </Headline>
              <Body className="mt-5 max-w-xl text-muted">
                A <Glossary term="mandate" /> is a signed permission, not a stored card. You sign it
                once with a passkey and it carries your ceiling, your merchant, and your expiry.
                Every charge after that is agent initiated, and none of them can leave those limits.
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
                  <Eyebrow className="text-muted">The card number</Eyebrow>
                  <Small className="mt-3">
                    Never touches the agent. Every charge mints a single use credential that dies
                    with that charge, and the dashboard shows which one was burned on what. There is
                    no stored card for an agent to leak or reuse.
                  </Small>
                </div>
                <div className="min-w-0">
                  <Eyebrow className="text-muted">Over the ceiling</Eyebrow>
                  <Small className="mt-3">
                    The over cap charge is not blocked by our code. It is sent, the card network
                    refuses it, and the decline comes back with a reason a seller can act on.
                    Nothing is spent and the mandate stays live.
                  </Small>
                </div>
              </Surface>
            </Rise>

            <Rise delay={180}>
              <Surface level="raised" className="mt-4 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3.5 sm:px-7">
                  <Eyebrow as="span" className="min-w-0 text-muted">
                    What the network said when the agent pushed
                  </Eyebrow>
                  <Mono className="min-w-0 text-muted">not our copy</Mono>
                </div>

                <div className="grid gap-3 px-5 py-6 sm:grid-cols-2 sm:px-7 sm:py-8">
                  {REFUSALS.map((r) => (
                    <Surface key={r.code} level="quiet" className="h-full p-5">
                      <Mono className="block text-[0.8125rem] text-foreground">{r.code}</Mono>
                      <Caption className="mt-3 block text-muted">{r.attempt}</Caption>
                      <p className="mt-3 border-l-2 border-border-strong pl-3 text-[0.8125rem] leading-relaxed text-muted">
                        {r.said}
                      </p>
                    </Surface>
                  ))}
                </div>

                <div className="border-t border-border px-5 py-5 sm:px-7">
                  <Small className="text-muted">
                    Both of those came back from the Visa network through Prava on this account, and
                    both are reproducible in the dashboard right now. Neither is a message this
                    project writes. The agent sends the charge, the network refuses it, and there is
                    no argument the agent can make that gets past either one.
                  </Small>
                </div>
              </Surface>
            </Rise>
          </div>
        </section>

        <section className={`border-b border-border ${SECTION_PAD}`}>
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Eyebrow className="text-muted">Who it is for, and what it would cost</Eyebrow>
              <Headline className="mt-4 max-w-3xl">
                For the seller who pays for every losing test out of the same budget.
              </Headline>
              <Body className="mt-5 max-w-2xl text-muted">
                Not everyone who runs ads. The one who spends enough that a bad creative is a number
                they feel, and who has nobody on staff to say when a test has run long enough to act
                on.
              </Body>
            </Rise>

            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              {BUYER.map((b, i) => (
                <Rise key={b.label} delay={i * 60}>
                  <Surface level="quiet" className="h-full p-5">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                      <p className="min-w-0 text-[0.9375rem] font-semibold tracking-tight">
                        {b.label}
                      </p>
                    </div>
                    <Caption className="mt-2.5 text-muted">{b.detail}</Caption>
                  </Surface>
                </Rise>
              ))}
            </div>

            <Rise delay={140}>
              <Surface level="raised" className="mt-4 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3.5 sm:px-7">
                  <Eyebrow as="span" className="min-w-0 text-muted">
                    What it is worth
                  </Eyebrow>
                  <Mono className="min-w-0 text-muted">no recovery figure of our own</Mono>
                </div>

                <div className="px-5 py-6 sm:px-7 sm:py-8">
                  <Body className="max-w-2xl">
                    We have never run a paid campaign, so we have no figure for what banditd saves a
                    seller, and we are not going to build one out of somebody else&apos;s estimate
                    of how much advertising is wasted.
                  </Body>
                  <Body className="mt-5 max-w-2xl text-muted">
                    What we can put a number on is the mistake. The rule most agents use calls a
                    false winner 44.5% of the time. The four gates call one 2.5% of the time. A
                    false winner is the expensive kind of error, because the seller believes it and
                    scales it. What the subscription buys is the ones that do not get made, and you
                    know better than we do what a scaled loser costs in your account.
                  </Body>
                </div>
              </Surface>
            </Rise>
          </div>
        </section>

        <section className={`border-b border-border ${SECTION_PAD}`}>
          <div className="mx-auto w-full max-w-5xl px-gutter">
            <Rise>
              <Eyebrow className="text-muted">What is not real yet</Eyebrow>
              <Headline className="mt-4 max-w-3xl">
                Two limits, said here rather than found later.
              </Headline>
            </Rise>

            <div className="mt-10 grid gap-3 lg:grid-cols-2">
              {LIMITS.map((limit, i) => (
                <Rise key={limit.label} delay={i * 70}>
                  <Surface level="quiet" className="h-full p-6 sm:p-8">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 shrink-0 rounded-full bg-border-strong" />
                      <p className="min-w-0 text-[0.9375rem] font-semibold tracking-tight">
                        {limit.label}
                      </p>
                    </div>
                    <Small className="mt-3 text-muted">{limit.detail}</Small>
                  </Surface>
                </Rise>
              ))}
            </div>

            <Rise delay={140}>
              <Surface level="base" className="mt-4 p-6 sm:p-8">
                <Eyebrow className="text-muted">The half that is real</Eyebrow>
                <Body className="mt-3 max-w-2xl text-muted">
                  The commerce protocol is not simulated. Point the agent at any storefront and it
                  reads the well known profile, asks the store what it sells, and tells you plainly
                  whether that store speaks the protocol at all.
                </Body>
                <Link
                  href="/merchant-check"
                  className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-[0.8125rem] font-semibold text-foreground hover:border-border-strong"
                >
                  Check a real store
                  <ArrowRight className="size-4" />
                </Link>
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
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <a
                    href="#start"
                    className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground inline-flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-lg bg-foreground px-6 text-[0.9375rem] font-semibold text-background transition-opacity hover:opacity-90 sm:w-auto"
                  >
                    Start a run
                    <ArrowRight className="size-4" />
                  </a>
                  <Link
                    href="/dashboard"
                    className="focus-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-lg border border-border bg-surface px-6 text-[0.9375rem] font-semibold text-foreground hover:border-border-strong sm:w-auto"
                  >
                    Open the last run
                  </Link>
                </div>
                <Caption className="mt-4 text-muted">
                  The dashboard keeps the last run in this browser, so you can read one without
                  starting one.
                </Caption>
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
