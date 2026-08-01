banditd

An agent that runs ads for you and spends its own money on the ones that work.

Built at the Agentic Commerce Hackathon, Jul 31 – Aug 2 2026.

Why

If you sell anything online you know the drill. You make twenty creatives, two of them actually convert, and you figure out which two after you've already burned the budget on the other eighteen.

banditd just does that part for you.

How it works

You paste in a product. Name, price, a sentence about it.

The agent looks up who buys this kind of thing and what everyone else is saying about it, then writes four different creatives, different angles, different images, different copy. It watches how they do. Once one of them is clearly winning it buys more render credits through Prava, by itself, and makes more of that one.

No approval step. No "hey, can I spend $4?" It just goes, inside the limits you set.

The limits

You give it a mandate before it can touch anything:

- max spend
- what it's allowed to buy
- when the permission expires
- a Face ID tap to turn it on

Dashboard shows what's left, why it bought each thing, and the single-use card it burned doing it. The card number never touches the agent.

If it tries to go over, it gets blocked and tells you why. That's in the demo on purpose, showing the thing fail is more convincing than showing it succeed.

Running it

```bash
git clone https://github.com/itzjk/banditd
cd banditd
npm install
cp .env.local.example .env.local
```

What has to be in `.env.local`:

```
OPENAI_API_KEY=sk-...
PRAVA_SECRET_KEY=sk_test_...
PRAVA_BASE_URL=https://sandbox.api.prava.space
PRAVA_USER_ID=seller_demo_1
PRAVA_USER_EMAIL=seller@banditd.dev
```

Everything else has a default and you can skip it: `MANDATE_CAP` (50.00), `RENDER_MERCHANT_NAME`, `RENDER_MERCHANT_URL`, `RENDER_MERCHANT_COUNTRY`, `RENDER_CREDIT_PRICE` (4.00), `OPENAI_TEXT_MODEL` (gpt-5.6-luna), `OPENAI_IMAGE_MODEL` (gpt-image-1-mini), `OPENAI_SEARCH_CONTEXT` (low).

Then you need a signed mandate. Without one the agent has nothing to charge and `/api/purchase` answers 400 telling you so.

```bash
npm run prava setup
```

That opens a Prava session and prints an `iframe_url`. Open it, approve with your passkey. That is the one and only time a human is in the loop. Then:

```bash
npm run prava list
```

Copy the mandate id into `.env.local`:

```
PRAVA_MANDATE_ID=mdt_...
```

The demo also fires a deliberate over-cap charge to show the ceiling holding. It uses the smallest signed mandate for that, or the one you pin:

```
PRAVA_REJECTION_MANDATE_ID=mdt_...
PRAVA_REJECTION_MANDATE_AMOUNT=5.00
```

Now run it:

```bash
npm run dev
```

The statistics are testable on their own, no keys involved:

```bash
node scripts/bandit-test.mts
```

Node 24, it runs the TypeScript straight. Around three and a half minutes on a laptop.

How it's built

Next 16 App Router, React 19, Tailwind 4, TypeScript. No database, no session store, no cache.

The whole run is one JSON object that travels in the request body. Every route takes a `state`, returns the state it produced, and the browser holds it in localStorage between calls. That is not a shortcut, it is the deployment target: on Vercel each invocation is a separate instance, so anything left in module memory is gone by the next request. Running locally the store also writes `data/state.json`, which is convenience for poking at it with curl, not the source of truth.

Six routes, one step each:

`POST /api/product` takes name, price, description and starts a clean run.

`POST /api/research` searches the live web and returns buyer profile, competitor angles, price positioning and the URLs it actually cited.

`POST /api/creatives` writes four creatives and generates four images. Pass a `parentId` and it breeds four new ones off the winner instead.

`POST /api/simulate` serves impressions against hidden per creative click rates, allocated by Thompson sampling.

`POST /api/decide` runs the bandit evaluation, hands the result plus the live mandate constraints to the model, and gets back either a purchase call or an abstention.

`POST /api/purchase` charges the mandate, rotates across the signed ones, reports the charge back to Prava. Send `force: true` and it deliberately charges over the ceiling so you can watch the rejection.

The five files in `lib` that matter:

`bandit.ts` is the posterior, the gates and the traffic simulation. Zero dependencies, the gamma sampler, the Beta sampler, log gamma and the mixture Bayes factor are all in there.

`store.ts` is the state shape and the coercion of everything arriving from the client, plus the audit log.

`openai.ts` is the three model calls.

`prava.ts` is a thin client over the Prava REST API and the decline normalization.

`mandate.ts` is mandate selection, rotation and the plain language a seller reads when a charge fails.

About the "clearly winning" part

"Buy when CTR is over 4%" is a number someone made up. First thing anyone asks is what if it was luck.

So each creative is an arm on a multi-armed bandit and the agent runs Thompson sampling over them. It only spends when it's sure the leader is actually the leader, with enough impressions behind it. Same approach real ad platforms use. Handles the luck question on its own.

That is the pitch. Here is the part that took the longest, because the obvious version of it is wrong.

Every arm gets a Beta posterior over its click rate with a Jeffreys prior, Beta(0.5, 0.5). At 0 clicks in 50 impressions a uniform prior says 1.9% and Jeffreys says 1.0%. On a product whose real click rate is 3%, that gap is what decides the early races.

Now the wrong part. "Probability of being the best is over 0.95" is not an error rate. It is a statement about one look at the data, and an agent that re-checks after every batch of traffic is not taking one look. Measured against known truth, two identical arms at 3% and 48 evaluations: the naive rule calls a false winner 44.5% of the time over 200 runs, and about 49% once you push it to 2000, where the estimate settles. Four identical arms, same conditions: around 7%. That is not a decision, that is a coin.

So the gate is three things and all three have to hold:

Probability of being best over 0.95.

Expected loss below 1% of the posterior mean. This is the effect size gate. It stops the agent paying $4 for a difference that is real and too small to care about.

An anytime-valid boundary. The e-value is the probability of being best times a mixture Bayes factor against the pooled null, and it has to clear 1/alpha, which is 20 at alpha 0.05. Ville's inequality bounds the probability that this ever crosses 20 under the null at 5%, however many times you look. That is the piece the naive rule does not have.

Same conditions: false positives drop to 0.5% with two arms over 200 runs, settling near 0.3% at 2000, and to roughly 0.1% with four. And when it does fire, it points at the truly best arm 100% of the time, in every configuration tested.

The 200 run figures are what `scripts/bandit-test.mts` prints, with a confidence interval of [37.8%, 51.4%] on that 44.5%. The larger numbers are where those estimates converge. ProofLab in the dashboard runs the same comparison in the browser, so anyone can push it further and watch it settle.

You can watch the four gates disagree. On 3 clicks in 220 impressions against 12 in 220, the probability of being best is 0.9936 and the expected loss is tiny, so three of the four gates say buy. The e-value is 1.48 against a bar of 20, so the agent holds. Twelve clicks against three looks decisive and it is not.

The Monte Carlo size is 20000 samples, not 500. At 500 the Monte Carlo standard deviation of the probability estimate was 0.0094, and on one dataset sitting near the threshold, byte for byte identical every time, 200 reruns flipped the verdict 100 times. Half. At that point the estimator is the coin, not the data.

`scripts/bandit-test.mts` reproduces all of it: the Beta sampler checked against analytic moments, both null scenarios, the detection runs against known truth, the Monte Carlo noise measurement and the gate by gate breakdown on fixed datasets. It prints the same tables the numbers above came from.

OpenAI

Three things, all doing real work:

Web search for the market research. Structured outputs so the creative specs come back as JSON I can feed straight into the render pipeline. Function calling for the spend decision itself, the model gets the bandit state and the mandate rules and either calls `purchase_render_credits(amount, reason)` or doesn't. That reason string is what shows up on the dashboard.

The abstention is the interesting one. There is no `should_buy: false` field anywhere. The model either emits a `function_call` or it doesn't, and the absence of the call is the decision to hold. Whatever it wrote instead becomes the line on the dashboard saying what it is still waiting for. You cannot fake that with a boolean.

The creative schema has the angle as an enum of price, ritual, gift and quality, so what comes back is four different arguments and not four rewordings of one.

The research call asks for `web_search_call.action.sources` and pulls the URL citations off the annotations, so the market panel shows what it read, not a claim that it read something.

Model is `gpt-5.6-luna`, and that is a token limit decision rather than a preference. On this account `terra` and `sol` cap at 10k tokens per minute and a single web search call asks for 13k.

Prava

session → mandate → passkey → single-use token → charge

Runs on Prava's REST API. Their stack sits on Visa Intelligent Commerce, which is the part that makes an agent-initiated card charge work at all under a mandate you can revoke.

What building against it actually taught us:

The mandate is created through the Sessions API with `mandate_setup`. The seller approves it once with a passkey. Every charge after that is agent-initiated with nobody in the loop, which is the whole point.

It has to be `recurring` with `merchant_scope: "listed"`. A `one_time` mandate gets consumed the moment you report the charge as approved, so the second purchase has nothing left to charge. That one cost the most hours.

A recurring mandate allows one charge per cycle. Monthly frequency means one charge a month, and a demo makes several purchases in five minutes. So the agent rotates: it lists the signed mandates, skips the ones already charged in this cycle and the ones with less left than the amount asked for, and moves down the list. Every rotation is written to the audit log, so you can see it happen.

Declines do not arrive as errors. They come back HTTP 200 with `status: "failed"` and code `DECLINED`, and the real reason is only in the message string. So `lib/prava.ts` reads the message and normalizes it: "exceeds threshold" becomes `THRESHOLD_EXCEEDED`, "already made in the current payment cycle" becomes `CYCLE_ALREADY_CHARGED`. Each code maps to a sentence a seller can act on.

The over-cap charge is not blocked by our code. We send it, the Visa network refuses it, and the decline comes back through Prava. Nothing was spent, the mandate is still live, and the dashboard says both. That is why the failure is in the demo.

What's simulated and what isn't

Performance is simulated. Each creative carries a hidden true click rate between 1.5% and 6.5%, derived from its id, and the agent never sees it. Traffic is allocated by Thompson sampling and every click is a draw against that hidden rate. Anywhere those numbers appear in the interface they are labeled as simulated.

That is the only simulated thing. The web search and its sources are real, the creative and image generation is real, the statistical decision is real, and the Prava transactions are real sandbox charges against a mandate a human signed with a passkey.

Stack

Next.js 16, React 19, TypeScript, Tailwind 4, OpenAI, the Prava REST API, deployed on Vercel.

What's next

Right now it's one seller, creative generation, and buying render credits.

After that: actual ad spend instead of just credits, live competitor tracking, generated video scripts.

Where it goes: the whole thing runs the store. Sourcing, pricing, catalog.

Disclosure

Design, architecture and reading through the Prava and OpenAI docs happened before the event. All the code here was written during the hackathon, repo was created empty before kickoff, commit history shows the build.

Performance numbers in the demo are simulated and labeled that way in the UI. Payments are sandbox.

Who

[@itzjk](https://github.com/itzjk)

MIT
