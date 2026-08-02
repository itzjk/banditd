banditd

An agent that tests ads, decides which ones to switch off, and spends its own money building on the one that won.

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

Node 24, it runs the TypeScript straight. The last full run printed `elapsed 1072.6s`, and the power curve is most of that. `RUNS`, `POWER_RUNS` and `POWER_LOOKS` are environment variables if you want it shorter, or longer once you stop believing the numbers.

How it's built

Next 16 App Router, React 19, Tailwind 4, TypeScript. No database, no session store, no cache.

The whole run is one JSON object that travels in the request body. Every route takes a `state`, returns the state it produced, and the browser holds it in localStorage between calls. That is not a shortcut, it is the deployment target: on Vercel each invocation is a separate instance, so anything left in module memory is gone by the next request. Running locally the store also writes `data/state.json`, which is convenience for poking at it with curl, not the source of truth.

Six routes, one step each:

`POST /api/product` takes name, price, description and starts a clean run.

`POST /api/research` searches the live web and returns buyer profile, competitor angles, price positioning and the URLs it actually cited.

`POST /api/creatives` writes four creatives and generates four images. Pass a `parentId` and it breeds four new ones off the winner instead.

`POST /api/simulate` serves impressions against hidden per creative click rates, allocated by Thompson sampling.

`POST /api/decide` runs the bandit evaluation, hands the result plus the live mandate constraints to the model, and gets back either a purchase call or an abstention.

`POST /api/purchase` charges the mandate, rotates across the signed ones, reports the charge back to Prava, and credits the ledger: one approved dollar is one render credit. Send `force: true` and it deliberately charges over the ceiling so you can watch the rejection.

`POST /api/image` renders one creative image and debits one render credit. At a balance of zero it answers 402: no render credits left, the agent has to buy more through the mandate before it can render.

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

Now the wrong part. "Probability of being the best is over 0.95" is not an error rate. It is a statement about one look at the data, and an agent that re-checks after every batch of traffic is not taking one look. Measured against known truth, two identical arms at 3% and 48 evaluations: the naive rule calls a false winner 44.5% of the time over 200 runs, and about 49% once you push it to 2000, where the estimate settles. Four identical arms, same conditions: 8.5%. That is not a decision, that is a coin.

So the gate is three things and all three have to hold:

Probability of being best over 0.95.

Expected loss below 1% of the posterior mean. This is the effect size gate. It stops the agent paying $4 for a difference that is real and too small to care about.

An anytime-valid boundary. The e-value is the probability of being best times a mixture Bayes factor against the pooled null, and it has to clear 1/alpha, which is 20 at alpha 0.05. Ville's inequality bounds the probability that this ever crosses 20 under the null at 5%, however many times you look. That is the piece the naive rule does not have.

Same conditions: false positives drop to 0.5% with two arms over 200 runs, settling near 0.3% at 2000, and to roughly 0.1% with four. And when it does fire, it points at the truly best arm 100% of the time, in every configuration tested.

Credit where it belongs. That boundary is not new mathematics and we are not claiming it is. A mixture sequential probability ratio test is Johari, Pekelis and Walsh, *Always Valid Inference: Bringing Sequential Analysis to A/B Testing* ([arXiv:1512.04922](https://arxiv.org/abs/1512.04922), later in *Operations Research*), and it has been in production since 2015 in Optimizely's Stats Engine and since in Statsig. Our contribution is not the test, it is where the test is wired. In every one of those products the boundary ends in a report a human reads and then acts on. Here it ends in the execution of a card charge under a signed mandate, with nobody in the loop: the same e-value that would have printed "significant" is the thing that authorises the money. That join is the part nobody else is doing.

The 200 run figures are what `scripts/bandit-test.mts` prints, with a confidence interval of [37.8%, 51.4%] on that 44.5%. The larger numbers are where those estimates converge. ProofLab runs the same comparison in the browser, folded shut under the error rate on the home page and at the end of the evidence band on the dashboard, so anyone can open it, push it further and watch it settle.

You can watch the four gates disagree. On 3 clicks in 220 impressions against 12 in 220, the probability of being best is 0.9936 and the expected loss is tiny, so three of the four gates say buy. The e-value is 1.48 against a bar of 20, so the agent holds. Twelve clicks against three looks decisive and it is not.

What that caution costs

An error rate on its own is a number anyone can win. A gate that never fires has a false positive rate of zero. So the power curve belongs printed next to it, and ours is not flattering everywhere.

Two arms, a control at 3.0% and a challenger above it, 150 runs a cell, 12 looks spread across the horizon. Lost clicks are counted against an oracle that knew the winner from the first impression, so lower is better. When a rule fires, the rest of the horizon goes to the arm it picked, right or wrong. The last column is what the same traffic costs if nobody ever decides at all.

First an even split, the classic A/B holdout, where every impression served undecided is half wasted.

| gap | impressions | naive fires | naive false winners | naive lost | gates fire | gates lost | never decides |
|---|---|---|---|---|---|---|---|
| 3.0% to 3.3% (+10%) | 12,000 | 54.0% | 8.7% | 14.4 | 0.7% | 17.9 | 18.0 |
| | 48,000 | 80.7% | 2.0% | 37.7 | 2.0% | 71.2 | 72.0 |
| | 200,000 | 100.0% | 0.0% | 79.3 | 46.7% | 257.0 | 300.0 |
| 3.0% to 3.6% (+20%) | 12,000 | 81.3% | 3.3% | 21.2 | 4.0% | 35.4 | 36.0 |
| | 48,000 | 100.0% | 0.0% | 41.1 | 47.3% | 123.7 | 144.0 |
| | 200,000 | 100.0% | 0.0% | 68.3 | 100.0% | 202.7 | 600.0 |
| 3.0% to 4.0% (+33%) | 12,000 | 94.0% | 0.0% | 23.3 | 21.3% | 55.3 | 60.0 |
| | 48,000 | 100.0% | 0.0% | 41.3 | 98.0% | 125.3 | 240.0 |
| | 200,000 | 100.0% | 0.0% | 86.7 | 100.0% | 145.5 | 1000.0 |
| 3.0% to 6.0% (+100%) | 12,000 | 100.0% | 0.0% | 19.8 | 100.0% | 46.7 | 180.0 |
| | 48,000 | 100.0% | 0.0% | 60.4 | 100.0% | 75.6 | 720.0 |
| | 200,000 | 100.0% | 0.0% | 250.0 | 100.0% | 250.0 | 3000.0 |
| 1.0% to 1.3% (+30%) | 12,000 | 69.3% | 6.0% | 12.2 | 2.0% | 17.9 | 18.0 |
| | 48,000 | 96.7% | 0.0% | 27.7 | 18.0% | 68.8 | 72.0 |
| | 200,000 | 100.0% | 0.7% | 46.0 | 97.3% | 145.3 | 300.0 |

On lost clicks the naive rule beats us in fourteen of those fifteen cells and ties us in the fifteenth. At a 10% lift over 48,000 impressions it loses 37.7 clicks and we lose 71.2, because we hold and keep paying for the split. Getting 3.0 against 3.3 backwards is cheap, and not deciding is not. That is the case against us and it is a fair one.

Then Thompson allocation, which is what banditd actually serves.

| gap | impressions | naive fires | naive false winners | naive lost | gates fire | gates lost | never decides |
|---|---|---|---|---|---|---|---|
| 3.0% to 3.3% (+10%) | 12,000 | 53.3% | 11.3% | 12.5 | 0.0% | 13.0 | 13.0 |
| | 48,000 | 74.0% | 5.3% | 29.9 | 0.7% | 30.1 | 30.1 |
| | 200,000 | 93.3% | 4.0% | 61.5 | 4.7% | 59.0 | 59.6 |
| 3.0% to 3.6% (+20%) | 12,000 | 64.7% | 4.7% | 15.3 | 0.7% | 15.5 | 15.5 |
| | 48,000 | 97.3% | 2.6% | 25.1 | 2.0% | 26.8 | 26.8 |
| | 200,000 | 100.0% | 1.3% | 40.0 | 6.0% | 38.7 | 38.7 |
| 3.0% to 4.0% (+33%) | 12,000 | 88.0% | 4.0% | 17.5 | 1.3% | 18.4 | 18.4 |
| | 48,000 | 100.0% | 0.7% | 17.6 | 2.7% | 22.0 | 22.0 |
| | 200,000 | 100.0% | 0.0% | 20.8 | 4.7% | 32.5 | 32.5 |
| 3.0% to 6.0% (+100%) | 12,000 | 100.0% | 0.0% | 7.5 | 4.7% | 11.2 | 11.2 |
| | 48,000 | 100.0% | 0.0% | 9.0 | 19.3% | 14.4 | 14.5 |
| | 200,000 | 100.0% | 0.0% | 12.8 | 58.0% | 18.4 | 19.4 |
| 1.0% to 1.3% (+30%) | 12,000 | 56.0% | 6.0% | 9.1 | 0.0% | 8.9 | 8.9 |
| | 48,000 | 92.0% | 1.3% | 14.4 | 2.0% | 16.7 | 16.7 |
| | 200,000 | 100.0% | 2.0% | 26.2 | 2.0% | 24.5 | 24.5 |

Same gates, same gaps, and the sign flips. Thompson is already steering traffic to whichever arm is ahead, so holding costs almost nothing: our lost clicks land within a click or two of the never decides column in every single row. The naive rule is still cheaper in seven of the fifteen, but by two to eight clicks spread over as much as 200,000 impressions. It ties in five. In three it is more expensive than we are, because its false winners cost more than our waiting does.

Which is the column to read alongside. Over all thirty cells and 4,500 runs the four gates never once named a false winner. The naive rule named one in 11.3% of runs at the hardest gap under Thompson and in 8.7% under an even split, and those are the runs where a seller scales a loser.

The uncomfortable half of the second table is our fires column. Under Thompson the gate rarely certifies anything at all, and the reason is that the two halves of the design pull against each other. Thompson starves the losing arm to stop paying for it, and the mixture Bayes factor needs data on both arms to rule out that they are the same. On a 3.0% against 6.0% race at 12,000 impressions the control has collected about 380 impressions to the winner's 11,600, and the e-value stalls near 1.4 against a bar of 20. Split the same traffic evenly and it clears 20 by impression 2,000. The allocator that earns the money is blindfolding the referee.

So is the bar simply set too high? Section 9 moves it and holds everything else fixed, reusing the same runs, since alpha only changes what the e-value is compared against.

| setup | median peak e-value | alpha 0.05, bar 20 | 0.10, bar 10 | 0.20, bar 5 | 0.50, bar 2 |
|---|---|---|---|---|---|
| even split, 3.0% to 3.3%, n=48,000 | 0.11 | 2.7% | 3.3% | 7.3% | 14.7% |
| even split, 3.0% to 4.0%, n=48,000 | 2.3e5 | 100.0% | 100.0% | 100.0% | 100.0% |
| thompson, 3.0% to 4.0%, n=48,000 | 1.03 | 3.3% | 6.0% | 11.3% | 30.0% |
| thompson, 3.0% to 6.0%, n=48,000 | 9.47 | 23.3% | 46.0% | 72.7% | 95.3% |

Two different failures wearing the same face. On the 10% lift under an even split the median peak e-value across a whole run is 0.11, so no bar anyone would still call a bar reaches it. That is not a threshold set too tight, it is the price of the guarantee: a boundary that has to hold under twelve looks cannot spend the evidence a single end of run test would spend, and at that effect size there is nothing left over. Lowering alpha to 0.50 moves lost clicks from 71.5 to 67.8 and the naive rule is at 37.7. Tuning does not close that gap and we are not going to pretend it does.

The Thompson rows are the opposite. At 3.0% against 6.0% the median peak e-value is 9.47 against a bar of 20, the right order of magnitude with the bar in the way. Dropping alpha to 0.20 takes firing from 23.3% to 72.7%, still with no false winners, and lost clicks from 14.4 to 13.4. For the traffic shape we actually serve, the default is stricter than the decision warrants.

That is an argument for a knob, not for a new default. `alpha` is already a field on `EvaluateOptions` and today nothing passes it, so every caller runs at 0.05. Exposing it per cohort is the change this measurement supports. We are not moving the default on the strength of one grid the night before a deadline, and the moment alpha goes above 0.20 the Ville bound stops being worth quoting, which is most of why anyone would trust the gate in the first place.

The honest summary is that we published the error rate and left out the price. The gate protects against declaring a false winner, and that is what matters when the consequence is an automatic irreversible charge and a creative the seller then scales. The naive rule decides sooner, and that is what matters when being wrong is cheap and the traffic is split evenly whether you have made up your mind or not. Both of those are true at once. A seller whose mistakes compound wants this gate. A seller who would notice and reverse a bad call next week does not, and should say so with alpha.

The Monte Carlo size is 20000 samples, not 500. At 500 the Monte Carlo standard deviation of the probability estimate was 0.0094, and on one dataset sitting near the threshold, byte for byte identical every time, 200 reruns flipped the verdict 100 times. Half. At that point the estimator is the coin, not the data.

`scripts/bandit-test.mts` reproduces all of it: the Beta sampler checked against analytic moments, both null scenarios, the detection runs against known truth, the Monte Carlo noise measurement, the gate by gate breakdown on fixed datasets, the power curve under both allocations and the alpha sweep. It prints the same tables the numbers above came from.

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

What the server refuses to believe

The state travels in the browser, and `/api/purchase` treats it as a proposal, not as truth: before any mandate is touched, the server re-runs the four gates on the cohort it was handed and answers 422 to any evidence that is implausible on its face, meaning a claimed CTR above 25% on any arm, more than 5,000,000 claimed impressions, or more clicks than impressions. Even a state the server believed cannot spend past what the seller signed, because the ceiling and the merchant scope are enforced by the Visa network, not by the client. In production the counts would come as signed server-side telemetry from the ad platform, with the browser only reading; the plausibility check is the demo-sized version of that boundary.

The ledger of what the money bought

Every approved charge delivers render credits at one dollar per render, written to a ledger on the state. Every image render debits one credit, and at zero `/api/image` answers 402 and the agent cannot make more until it buys again through the mandate. The run starts with a starter grant of 4 renders, so the first generation is on the house and every one after that is bought, debited and audited.

What's simulated and what isn't

Performance is simulated. Each creative carries a hidden true click rate derived from its id, and the agent never sees it. A first generation creative sits between 1.5% and 6.5%. A creative bred from a winner inherits the parent rate with drift on top, so bred rates land anywhere from 0.9% to 10.4%. Traffic is allocated by Thompson sampling and every click is a draw against that hidden rate. Anywhere those numbers appear in the interface they are labeled as simulated.

That is the only simulated thing. The web search and its sources are real, the creative and image generation is real, the statistical decision is real, and the Prava transactions are real sandbox charges against a mandate a human signed with a passkey.

One of those charges is `ord_01KZ085GMNRTHFW216PGWFG7DP`, four dollars of render credits pulled on 2 August 2026 against mandate `mdt_01KZ084...`, a recurring monthly mandate with a fifty dollar ceiling that a human approved with a passkey and that stays valid until 1 September 2026. It shows in the Prava dashboard as a Visa mandate charge that reached Creds_Generated, which is the point where the network hands over a single use card. The reference the agent sent is `banditd_verify_1785641222`. That order is stated here so the claim above can be checked against Prava's own record instead of taken from this file.

Three limits worth saying out loud rather than leaving to be found.

The merchant on the other side of the render credits charge is us. Banditd Render Credits is a first party destination this project operates, not an independent store, and there is no acquirer between the two ends of that transaction. So when the charge completes and the agent reports the outcome back to Prava as APPROVED, that outcome is self declared: we are the ones saying the goods were delivered. The line is worth drawing precisely, because the half that is not self declared is the half the demo is about. The mandate, the per charge ceiling, the merchant scope, the single use card and every decline come from the Visa network through Prava and we cannot talk our way past any of them. What the credits buy is real inside the product too: each one is debited on a render and at zero the agent cannot render again until it buys. Every purchase writes the self declaration into the audit log and returns it on the API response, so nothing about it has to be taken on trust from this file.

There is no Meta or Google integration. The ad circuit is the simulator and nothing else, so what this demonstrates is the governance of autonomous spend, not the buying of media. The payment circuit is the half that is real.

And the engine decides on click through rate, which is an imperfect stand in for a sale. The mathematics is indifferent to which event it counts, a posterior over purchases behaves exactly like a posterior over clicks and none of the four gates change. What changes is the wait: the floor of the trade is around 50 conversion events per variant, so on conversions the same engine needs a lot more traffic before it will call anything.

Stack

Next.js 16, React 19, TypeScript, Tailwind 4, OpenAI, the Prava REST API, deployed on Vercel.

Who it's for, and what it would cost

Everything in this section is a proposal. banditd has no customers, no revenue and nothing for sale. It was built in 34 hours at a hackathon. The numbers below are how we would price it, not money anyone has paid.

The buyer is a seller, not an agency and not a brand team. One store, one catalog, paid traffic is how it grows. Spending roughly $10,000 to $250,000 a month on ads, which is the band where a losing creative is a number you feel and there is still nobody on staff who can tell you when a test has run long enough. Below that band, testing is cheap enough to guess at. Above it there is an in-house analyst whose job this already is.

We do not price by managed ad spend, because the agent does not manage ad spend. It buys render credits, and inside a platform like Meta a third party cannot move budget between ads anyway: individual ads have no budget of their own, they compete for the ad set's and the delivery system reallocates by itself. What a third party can actually do is switch creative off and on. So the unit is the work the engine really does, a creative test, meaning one cohort of four ads judged together:

| A month | Concurrent creative tests |
|---|---|
| $149 | 3 tests at once, 12 variants under watch |
| $399 | 15 tests at once, 60 variants |
| $999 | 60 tests at once, 240 variants |

Every tier is the same product. The only thing that moves is how many tests it watches at once.

On the price itself: [Adalysis](https://adalysis.com/pricing/) is $149 a month up to $50,000 of managed spend, $349 to $250,000 and $950 to $1M; [Optmyzr](https://www.optmyzr.com/pricing/) starts at $299 up to $25,000. Those are Google and Microsoft Ads tools sold mostly to agencies, so they anchor what a decision tool costs a month in a neighbouring category, not in ours, and their unit is exactly the one we just rejected. Neither of them buys anything on your behalf.

Does the money work? We cannot answer that honestly, so we are not going to pretend to. We have never run a paid campaign, we have no recovery figure of our own, and we are not going to manufacture one out of somebody else's estimate of how much advertising is wasted. What we can put a number on is the mistake: the naive rule calls a false winner 44.5% of the time and the four gates call one 0.5% of the time. A false winner is the expensive error, because a seller believes it and scales it. What a subscription buys is the ones that do not get made, and the seller knows better than we do what a scaled loser costs in their account.

That is the half of the ledger that favours us and it should not be quoted on its own. The power curve is the other half: on a fixed even split the naive rule reached the right answer sooner and lost fewer clicks doing it at every gap we measured. This is worth paying for when a wrong call is expensive to unwind and the agent acts without asking. It is not worth paying for when a wrong call costs a few clicks and someone would catch it next week.

What we would be selling is not render credits. It is the layer that governs the spend: a signed mandate, a verifiable criterion for spending, a readable decline when it goes over, and a receipt that says why. Render credits are the smallest thing an agent can buy to exercise that whole circuit end to end.

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
