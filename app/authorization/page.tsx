import Link from "next/link";
import type { ReactNode } from "react";
import { readAuthorization, daysLeft, type SignedMandate } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "What you authorized",
  description:
    "The spending mandate the agent runs on, read live from Prava: the ceiling, the merchant, the expiry date and the one charge it gets per monthly cycle.",
};

function dollars(value: number | null): string | null {
  if (value === null) return null;
  return `$${value.toFixed(2)}`;
}

function Row({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border py-3.5 sm:flex-row sm:gap-6">
      <span className="shrink-0 text-[0.8125rem] text-muted sm:w-40 sm:pt-px">{label}</span>
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-semibold text-foreground [overflow-wrap:anywhere]">
          {value}
        </span>
        {note ? (
          <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted">{note}</span>
        ) : null}
      </span>
    </div>
  );
}

function expiryNote(mandate: SignedMandate): string {
  const days = daysLeft(mandate.expiryIso);
  if (days === null) return "Prava did not report an expiry date on this mandate";
  if (days < 0) return "already past, this mandate cannot be charged";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow, then the agent needs a new one";
  return `in ${days} days, then the agent needs a new one`;
}

function leadSentence(mandate: SignedMandate): string {
  const ceiling = dollars(mandate.ceiling);
  const parts: string[] = [ceiling ? `One charge of up to ${ceiling} a month` : "One charge a month"];
  if (mandate.merchant) parts.push(`to ${mandate.merchant} and nowhere else`);
  if (mandate.expiry) parts.push(`until ${mandate.expiry}`);
  return `${parts.join(", ")}.`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export default async function AuthorizationPage() {
  const read = await readAuthorization();
  const mandate = read.inForce;
  const used = read.spent.filter((m) => m.id !== mandate?.id);

  return (
    <div className="flex min-h-full flex-1 flex-col [overflow-wrap:anywhere]">
      <div className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-1 px-gutter py-3.5 text-[0.8125rem]">
          <Link
            href="/dashboard"
            className="focus-ring font-semibold text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
          >
            banditd
          </Link>
          <span className="text-muted">What you authorized</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-muted">
            <span className="size-1.5 rounded-full bg-accent" />
            Prava sandbox
          </span>
        </div>
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-gutter py-8 sm:py-12">
        {!read.live ? (
          <>
            <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.875rem]">
              Prava did not answer, so there is nothing here we can call a fact
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
              What you authorized lives on the mandate you signed at Prava, and this page only reads
              it. The read failed just now, so nothing is shown rather than guessed. Reload in a
              moment. Nothing about your authorization changed because a page could not load it.
            </p>
            {read.error ? (
              <p className="mt-3 font-mono text-[0.75rem] leading-relaxed text-subtle">
                {read.error}
              </p>
            ) : null}
          </>
        ) : !mandate ? (
          <>
            <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.875rem]">
              You have not authorized anything, so the agent cannot spend a cent
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
              Prava answered and there is no active mandate on this account. Every purchase the agent
              tries is refused before it reaches a card. The run itself still works, only the money is
              off.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-foreground sm:text-[1.875rem]">
              {leadSentence(mandate)}
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
              This is the whole permission the agent runs on, read from Prava a second ago. Nothing on
              this page is a template.
            </p>

            <div className="mt-8">
              <Row
                label="Most it can charge"
                value={dollars(mandate.ceiling) ?? "Not reported by Prava"}
                note="per charge, and Prava refuses anything above it"
              />
              <Row
                label="Merchant"
                value={mandate.merchant ?? "Not reported by Prava"}
                note={
                  mandate.scope === "listed"
                    ? "merchant scope is listed, so a charge to any other store is refused"
                    : "the only merchant this mandate was signed for"
                }
              />
              <Row
                label="How often"
                value={
                  mandate.frequency
                    ? `${mandate.frequency}, one charge per cycle`
                    : "One charge per cycle"
                }
                note="the count is the limit that bites first, not the ceiling"
              />
              <Row
                label="This cycle"
                value={mandate.chargeUsedThisCycle ? "The charge is used" : "One charge available"}
                note={
                  mandate.chargeUsedThisCycle
                    ? `${dollars(mandate.remaining) ?? "the balance"} of ${dollars(mandate.ceiling) ?? "the ceiling"} is still there and still cannot be spent until the cycle renews`
                    : "nothing has been charged against this mandate in the current cycle"
                }
              />
              <Row
                label="Expires"
                value={mandate.expiry ?? "Not reported by Prava"}
                note={expiryNote(mandate)}
              />
              <Row
                label="Mandate"
                value={<span className="font-mono text-[0.8125rem]">{mandate.id}</span>}
                note={`status ${mandate.status} at Prava`}
              />
            </div>

            <section className="mt-10">
              <h2 className="text-[0.9375rem] font-semibold text-foreground">
                The count runs out before the money does
              </h2>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">
                A monthly mandate allows one charge per cycle. The second purchase in the same month
                is refused by Prava even with{" "}
                {dollars(mandate.ceiling) ?? "the ceiling"} untouched, so the number that stops the
                agent first is the count, not the money. That refusal is the guardrail doing its job.
                {read.queued.length
                  ? ` ${read.queued.length} more mandate${read.queued.length === 1 ? "" : "s"} you signed are queued behind this one, and the agent moves to the next one instead of retrying this one.`
                  : " There is no other signed mandate behind this one, so the agent stops buying until you sign another."}
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-[0.9375rem] font-semibold text-foreground">You can stop it</h2>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">
                Revoking takes one click on the dashboard, in the bar at the top under Limits and
                stop. It bites on the very next attempt: Prava refuses the charge before a card is
                ever issued. Charges already made stand as they are.
              </p>
            </section>
          </>
        )}

        <section className="mt-10 border-t border-border pt-6">
          <h2 className="text-[0.9375rem] font-semibold text-foreground">
            Where the signature happened
          </h2>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">
            banditd never showed you a passkey prompt, and this page cannot sign anything. Every
            mandate on this account was opened as a Prava session and approved with a passkey on
            Prava&apos;s own screen, outside this app. That is the only place the signature happens,
            and this page is the record of what came back from it.
          </p>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">
            To sign another one, <span className="font-mono text-[0.8125rem]">npm run prava setup</span>{" "}
            opens the session and prints the Prava URL where you approve it.
          </p>
        </section>

        {read.live && (read.queued.length || used.length || read.elsewhere.length) ? (
          <section className="mt-10 border-t border-border pt-6">
            <h2 className="text-[0.9375rem] font-semibold text-foreground">
              Everything else you signed
            </h2>
            <ul className="mt-2 space-y-1.5 text-[0.9375rem] leading-relaxed text-muted">
              {read.queued.length ? (
                <li>
                  {read.queued.length} {plural(read.queued.length, "mandate", "mandates")} for the
                  same merchant with the cycle charge unused. The agent falls through to{" "}
                  {plural(read.queued.length, "it", "them")} when this one is spent.
                </li>
              ) : null}
              {used.length ? (
                <li>
                  {used.length} {plural(used.length, "mandate", "mandates")} already charged in this
                  cycle. The ceilings are intact and nothing can be taken from them until they renew.
                </li>
              ) : null}
              {read.elsewhere.length ? (
                <li>
                  {read.elsewhere.length}{" "}
                  {plural(read.elsewhere.length, "mandate", "mandates")} signed for another merchant
                  (
                  {read.elsewhere
                    .map((m) => `${m.merchant} ${dollars(m.ceiling) ?? "amount unknown"}`)
                    .join(", ")}
                  ), which this agent never charges for render credits.
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        <p className="mt-10 border-t border-border pt-6 text-[0.8125rem] leading-relaxed text-muted">
          Payments run against the Prava sandbox, so no real money moves. The mandate, the ceiling,
          the merchant lock and the single use card are the real Visa flow.
        </p>
      </main>
    </div>
  );
}
