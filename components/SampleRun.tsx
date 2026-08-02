import {
  SAMPLE_ADS,
  SAMPLE_CALL,
  SAMPLE_CHARGES,
  SAMPLE_PRODUCT,
  SAMPLE_TOTALS,
  type SampleAd,
  type SampleCharge,
} from "@/lib/sample-run";

function Sim() {
  return (
    <span className="shrink-0 rounded border border-white/12 px-1 py-px text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
      Sim
    </span>
  );
}

function rate(ad: SampleAd): string {
  if (!ad.impressions) return "0.0%";
  return `${((ad.clicks / ad.impressions) * 100).toFixed(1)}%`;
}

function Ad({ ad }: { ad: SampleAd }) {
  return (
    <div
      className={`min-w-0 rounded-xl border px-3 py-2.5 ${
        ad.winner ? "border-white/30 bg-white/[0.06]" : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          {ad.angle}
        </span>
        {ad.winner ? (
          <span className="rounded bg-white px-1 py-px text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-950">
            Winner
          </span>
        ) : null}
      </div>
      <p className="mt-1 break-words text-[13px] font-semibold leading-snug text-white">
        {ad.headline}
      </p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] tabular-nums text-zinc-400">
        <span>{ad.impressions.toLocaleString()} impressions</span>
        <span>{ad.clicks.toLocaleString()} clicks</span>
        <span className={ad.winner ? "font-semibold text-white" : "text-zinc-300"}>{rate(ad)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sim }: { label: string; value: string; sim?: boolean }) {
  return (
    <div className="min-w-0 bg-zinc-950 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
          {label}
        </span>
        {sim ? <Sim /> : null}
      </div>
      <div className="mt-1 truncate text-[16px] font-semibold leading-tight tabular-nums text-white">
        {value}
      </div>
    </div>
  );
}

function Total({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-1">
        {dot ? (
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        ) : null}
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          {label}
        </span>
      </div>
      <div className="mt-1 truncate text-[15px] font-semibold leading-tight tabular-nums text-white">
        {value}
      </div>
    </div>
  );
}

function Charge({ charge }: { charge: SampleCharge }) {
  const ok = charge.ok;
  return (
    <article
      className={`overflow-hidden rounded-xl border-l-2 border-y border-r px-3 py-3 ${
        ok
          ? "border-l-emerald-400/70 border-y-white/10 border-r-white/10 bg-emerald-400/[0.04]"
          : "border-l-rose-400/70 border-y-white/10 border-r-white/10 bg-rose-500/[0.04]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
            ok ? "bg-emerald-400/20 text-emerald-300" : "bg-rose-400/20 text-rose-300"
          }`}
        >
          {ok ? "Charged" : "Blocked"}
        </span>
        <span
          className={`text-[18px] font-semibold leading-none tabular-nums ${
            ok ? "text-emerald-200" : "text-rose-200"
          }`}
        >
          ${charge.amount}
        </span>
        {charge.code ? (
          <span className="rounded-md bg-rose-400/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-300 [overflow-wrap:anywhere]">
            {charge.code}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] text-zinc-400">{SAMPLE_PRODUCT.when}</span>
      </div>

      <p
        className={`mt-2 text-[12px] font-medium leading-snug ${
          ok ? "text-emerald-200" : "text-rose-200"
        }`}
      >
        {charge.title}. {charge.ruling}
      </p>

      <p className="mt-1.5 break-words text-[13px] leading-relaxed text-zinc-200">
        {charge.attempt}
      </p>

      {charge.said ? (
        <div className="mt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            What the network said
          </div>
          <p className="mt-1 rounded-lg bg-zinc-950/80 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
            {charge.said}
          </p>
        </div>
      ) : null}

      <dl className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {charge.facts.map((fact) => (
          <div key={fact.label} className="min-w-0 rounded-lg bg-white/[0.04] px-2.5 py-2">
            <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">
              {fact.label}
            </dt>
            <dd
              className={`mt-0.5 text-[12px] font-semibold text-zinc-100 [overflow-wrap:anywhere] ${
                fact.mono ? "font-mono" : "tabular-nums"
              }`}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-2.5 break-words text-[11px] leading-relaxed text-zinc-400">{charge.check}</p>
    </article>
  );
}

export default function SampleRun() {
  return (
    <section aria-label="Frozen example of a finished run" className="scroll-mt-20">
      <div className="overflow-hidden rounded-2xl border border-amber-400/30 bg-white/[0.02]">
        <div className="border-b border-white/[0.07] bg-amber-400/[0.06] px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-amber-400/40 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200">
              Frozen example
            </span>
            <h2 className="t-title min-w-0 break-words text-white">
              A run that already happened, kept here so nothing has to be taken on faith
            </h2>
          </div>
          <p className="mt-1.5 max-w-3xl break-words text-[12px] leading-relaxed text-zinc-300">
            Nothing on this card is live and nothing on it can be changed. The order, the reference
            and the two decline messages are real and can be checked against the Prava dashboard. The
            impressions and clicks are simulated, the same as everywhere else on this page. Start
            your own run and this example steps aside for it.
          </p>
        </div>

        <div className="space-y-4 px-3 py-4 sm:px-4">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="t-small font-semibold text-white">The four ads it wrote</h3>
                <Sim />
              </div>
              <span className="min-w-0 break-words text-[11px] text-zinc-400">
                {SAMPLE_PRODUCT.name}, {SAMPLE_PRODUCT.price}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {SAMPLE_ADS.map((ad) => (
                <Ad key={ad.angle} ad={ad} />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/20 bg-white/[0.04] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-950">
                Spending
              </span>
              <h3 className="t-small min-w-0 break-words font-semibold text-white">
                It called the {SAMPLE_CALL.winnerAngle} angle and spent ${SAMPLE_CALL.amount}
              </h3>
            </div>
            <p className="mt-2 break-words text-[13px] leading-relaxed text-zinc-200">
              {SAMPLE_CALL.reason}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.08] sm:grid-cols-4">
              <Stat label="Probability best" value={SAMPLE_CALL.probabilityBest} sim />
              <Stat label="Impressions" value={SAMPLE_CALL.impressions.toLocaleString()} sim />
              <Stat label="Clicks" value={SAMPLE_CALL.clicks.toLocaleString()} sim />
              <Stat label="Gates cleared" value="4 of 4" />
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="t-small font-semibold text-white">Money it moved</h3>
              <span className="min-w-0 break-words text-[11px] text-zinc-400">
                Real charges against the Prava sandbox
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 divide-x divide-white/[0.07] overflow-hidden rounded-xl bg-white/[0.02]">
              <Total label="Spent" value={`$${SAMPLE_TOTALS.spent}`} dot="bg-emerald-400" />
              <Total label="Blocked" value={`$${SAMPLE_TOTALS.blocked}`} dot="bg-rose-400" />
              <Total label="Charges" value={SAMPLE_TOTALS.charges} />
            </div>
            <div className="mt-2 space-y-2">
              {SAMPLE_CHARGES.map((charge) => (
                <Charge key={charge.id} charge={charge} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
