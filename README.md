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

`bandit.ts` is the posterior, the gates and the traffic simulation. Zero dependencies, the gamma sampler, the Beta sampler, log gamma and the cohort Bayes factor behind the e-value are all in there.

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

An anytime-valid boundary. The e-value is a Bayes factor between two models of the cohort, one in which every creative shares a single click rate and one in which exactly one creative differs, divided by a calibration constant of 1.4 so that its expectation under the null stays at or below 1 everywhere we could measure it. It has to clear 1/alpha, which is 20 at alpha 0.05. Ville's inequality bounds the probability that it ever crosses 20 under the null at 5%, however many times you look. That is the piece the naive rule does not have.

Same conditions: false positives drop to 2.5% with two arms over 200 runs, settling near 1.25% at 2000 where the estimate stops moving, and to 0.7% with four. And when it fires on a cohort that really does have a winner, it names that winner in 4,495 of the 4,500 runs behind the power tables below.

Credit where it belongs. None of that boundary is new mathematics and we are not claiming it is. What is implemented is an e-value, a nonnegative statistic whose expectation under the null is at most 1, read against Ville's inequality. The modern account of that is Grünwald, de Heide and Koolen, *Safe Testing* ([arXiv:1906.07801](https://arxiv.org/abs/1906.07801), later in *JRSS-B*), and the survey of the field is Ramdas, Grünwald, Vovk and Shafer, *Game-theoretic statistics and safe anytime-valid inference* ([arXiv:2210.01948](https://arxiv.org/abs/2210.01948)). The nearest relative to the specific test in `bandit.ts` is Turner, Ly and Grünwald on safe two-sample tests for contingency tables ([arXiv:2106.02693](https://arxiv.org/abs/2106.02693)), which disposes of the shared base rate by conditioning on the margins where we dispose of it with a prior.

A correction, because an earlier version of this file got the attribution wrong. It cited Johari, Pekelis and Walsh, *Always Valid Inference: Bringing Sequential Analysis to A/B Testing* ([arXiv:1512.04922](https://arxiv.org/abs/1512.04922), later in *Operations Research*), and called what we ship an mSPRT. It is not one. An mSPRT mixes over the effect size under a single null; what is here is a Bayes factor between two composite models. They are relatives in the same family of test martingales, not the same test. The prior art is real, it has been in production since 2015 in Optimizely's Stats Engine and since in Statsig, and the credit is theirs. The label was ours and it did not fit.

Our contribution is not the test, it is where the test is wired. In every one of those products the boundary ends in a report a human reads and then acts on. Here it ends in the execution of a card charge under a signed mandate, with nobody in the loop: the same e-value that would have printed "significant" is the thing that authorises the money. That join is the part nobody else is doing.

The 200 run figures are what `scripts/bandit-test.mts` prints, with a confidence interval of [37.8%, 51.4%] on that 44.5%. The larger numbers are where those estimates converge. ProofLab runs the same comparison in the browser, folded shut under the error rate on the home page and at the end of the evidence band on the dashboard, so anyone can open it, push it further and watch it settle.

You can watch the four gates disagree. On 3 clicks in 220 impressions against 12 in 220, the probability of being best is 0.9936 and the expected loss is tiny, so three of the four gates say buy. The e-value is 3.52 against a bar of 20, so the agent holds. Twelve clicks against three looks decisive and it is not.

What that caution costs

An error rate on its own is a number anyone can win. A gate that never fires has a false positive rate of zero. So the power curve belongs printed next to it, and ours is not flattering everywhere.

Two arms, a control at 3.0% and a challenger above it, 150 runs a cell, 12 looks spread across the horizon. Lost clicks are counted against an oracle that knew the winner from the first impression, so lower is better. When a rule fires, the rest of the horizon goes to the arm it picked, right or wrong. The last column is what the same traffic costs if nobody ever decides at all.

First an even split, the classic A/B holdout, where every impression served undecided is half wasted.

| gap | impressions | naive fires | naive false winners | naive lost | gates fire | gates lost | never decides |
|---|---|---|---|---|---|---|---|
| 3.0% to 3.3% (+10%) | 12,000 | 54.0% | 8.7% | 14.4 | 5.3% | 17.5 | 18.0 |
| | 48,000 | 80.7% | 2.0% | 37.7 | 4.7% | 71.0 | 72.0 |
| | 200,000 | 100.0% | 0.0% | 79.3 | 59.3% | 231.8 | 300.0 |
| 3.0% to 3.6% (+20%) | 12,000 | 81.3% | 3.3% | 21.2 | 6.0% | 35.1 | 36.0 |
| | 48,000 | 100.0% | 0.0% | 41.1 | 64.0% | 109.0 | 144.0 |
| | 200,000 | 100.0% | 0.0% | 68.3 | 100.0% | 166.3 | 600.0 |
| 3.0% to 4.0% (+33%) | 12,000 | 94.0% | 0.0% | 23.3 | 34.7% | 51.8 | 60.0 |
| | 48,000 | 100.0% | 0.0% | 41.3 | 98.7% | 103.7 | 240.0 |
| | 200,000 | 100.0% | 0.0% | 86.7 | 100.0% | 125.6 | 1000.0 |
| 3.0% to 6.0% (+100%) | 12,000 | 100.0% | 0.0% | 19.8 | 100.0% | 38.4 | 180.0 |
| | 48,000 | 100.0% | 0.0% | 60.4 | 100.0% | 68.0 | 720.0 |
| | 200,000 | 100.0% | 0.0% | 250.0 | 100.0% | 250.0 | 3000.0 |
| 1.0% to 1.3% (+30%) | 12,000 | 69.3% | 6.0% | 12.2 | 9.3% | 17.3 | 18.0 |
| | 48,000 | 96.7% | 0.0% | 27.7 | 39.3% | 64.2 | 72.0 |
| | 200,000 | 100.0% | 0.7% | 46.0 | 98.7% | 119.8 | 300.0 |

On lost clicks the naive rule beats us in fourteen of those fifteen cells and ties us in the fifteenth. At a 10% lift over 48,000 impressions it loses 37.7 clicks and we lose 71.2, because we hold and keep paying for the split. Getting 3.0 against 3.3 backwards is cheap, and not deciding is not. That is the case against us and it is a fair one.

Then Thompson allocation, which is what banditd actually serves.

| gap | impressions | naive fires | naive false winners | naive lost | gates fire | gates lost | never decides |
|---|---|---|---|---|---|---|---|
| 3.0% to 3.3% (+10%) | 12,000 | 53.3% | 11.3% | 12.5 | 2.0% | 13.0 | 13.0 |
| | 48,000 | 74.0% | 5.3% | 29.9 | 0.7% | 30.1 | 30.1 |
| | 200,000 | 93.3% | 4.0% | 61.5 | 6.7% | 58.8 | 59.6 |
| 3.0% to 3.6% (+20%) | 12,000 | 64.7% | 4.7% | 15.3 | 4.0% | 15.5 | 15.5 |
| | 48,000 | 97.3% | 2.6% | 25.1 | 7.3% | 27.3 | 26.8 |
| | 200,000 | 100.0% | 1.3% | 40.0 | 16.0% | 44.5 | 38.7 |
| 3.0% to 4.0% (+33%) | 12,000 | 88.0% | 4.0% | 17.5 | 3.3% | 18.4 | 18.4 |
| | 48,000 | 100.0% | 0.7% | 17.6 | 13.3% | 21.9 | 22.0 |
| | 200,000 | 100.0% | 0.0% | 20.8 | 19.3% | 32.1 | 32.5 |
| 3.0% to 6.0% (+100%) | 12,000 | 100.0% | 0.0% | 7.5 | 24.7% | 11.2 | 11.2 |
| | 48,000 | 100.0% | 0.0% | 9.0 | 64.7% | 13.9 | 14.5 |
| | 200,000 | 100.0% | 0.0% | 12.8 | 96.7% | 16.3 | 19.4 |
| 1.0% to 1.3% (+30%) | 12,000 | 56.0% | 6.0% | 9.1 | 2.0% | 8.9 | 8.9 |
| | 48,000 | 92.0% | 1.3% | 14.4 | 8.7% | 16.5 | 16.7 |
| | 200,000 | 100.0% | 2.0% | 26.2 | 10.0% | 24.4 | 24.5 |

Same gates, same gaps, and the sign flips. Thompson is already steering traffic to whichever arm is ahead, so holding costs almost nothing: our lost clicks land within a click of the never decides column in eleven of the fifteen rows. The naive rule is cheaper in eight, by two to eleven clicks spread over as much as 200,000 impressions, ties in five, and is more expensive in two, because its false winners cost more than our waiting does.

One row is worth naming rather than averaging away. At 3.0% against 3.6% over 200,000 impressions we lose 44.5 clicks against 38.7 for never deciding, so the gate is actively worse than silence there. It fires 16.0% of the time and one of those fires picks the 3.0% arm, and a wrong commitment holds for the rest of the horizon. That row did not exist in the previous version of this table because the gate almost never fired at all, and it is part of the bill for the prior fix described further down.

Which is the column to read alongside. Over all thirty cells and 4,500 runs the four gates named a false winner five times. The naive rule named one in 11.3% of runs at the hardest gap under Thompson and in 8.7% under an even split, and those are the runs where a seller scales a loser. Five in 4,500 is not zero and the previous version of this file said zero, which was true of the gate as it stood and is no longer true of the gate as it ships.

The uncomfortable half of the second table used to be our fires column, and it is where the prior fix shows up most. Thompson starves the losing arm to stop paying for it, and the Bayes factor needs data on both arms to rule out that they are the same, so the allocator that earns the money was blindfolding the referee. On a 3.0% against 6.0% race at 12,000 impressions the control has collected about 380 impressions to the winner's 11,600: on that exact table the e-value used to stall at 1.4 against a bar of 20 and now reads 7.15, while the same traffic split evenly still clears 20 by impression 2,000. Across the whole race the gate now certifies the winner 24.7% of the time at 12,000 impressions, 64.7% at 48,000 and 96.7% at 200,000, against 4.7%, 19.3% and 58.0% before, and at 200,000 it costs less than never deciding, 16.3 clicks against 19.4. The referee can see again. It still cannot see a 10% lift under Thompson and nothing below claims otherwise.

So is the bar simply set too high? Section 9 moves it and holds everything else fixed, reusing the same runs, since alpha only changes what the e-value is compared against.

| setup | median peak e-value | alpha 0.05, bar 20 | 0.10, bar 10 | 0.20, bar 5 | 0.50, bar 2 |
|---|---|---|---|---|---|
| even split, 3.0% to 3.3%, n=48,000 | 0.48 | 8.0% | 11.3% | 18.0% | 25.3% |
| even split, 3.0% to 4.0%, n=48,000 | 9.3e5 | 100.0% | 100.0% | 100.0% | 100.0% |
| thompson, 3.0% to 4.0%, n=48,000 | 4.13 | 11.3% | 26.0% | 43.3% | 72.0% |
| thompson, 3.0% to 6.0%, n=48,000 | 31.3 | 68.7% | 94.0% | 98.7% | 100.0% |

Two different failures wearing the same face. On the 10% lift under an even split the median peak e-value across a whole run is 0.48 against a bar of 20, so alpha would have to be loosened past any value worth calling a bar before it mattered much, and even at 0.50 the gate fires a quarter of the time and lost clicks move from 70.2 to 63.7 against 37.7 for the naive rule. The Thompson rows are the opposite. At 3.0% against 6.0% the median peak is 31.3, above the bar rather than under it, and dropping alpha to 0.20 takes firing from 68.7% to 98.7% and lost clicks from 13.7 to 11.6. For the traffic shape we actually serve the default is still stricter than the decision warrants, which is an argument for a knob and not for a new default.

Those are the numbers as they stand today. The table an earlier version of this file printed had a median peak of 0.11 on the first row and 9.47 on the last, and the conclusion drawn from it was wrong in a way worth being exact about. It said the even split row "is not a threshold set too tight, it is the price of the guarantee." That sentence is false. A large part of what it called the price of the guarantee was the price of our prior, and we never looked at the prior because we had decided in advance that alpha was the suspect. Everything above this paragraph in this section is already measured on the corrected gate. What follows is what was corrected.

Where the power actually went

The e-value is a Bayes factor between two models. Under the null every arm shares one click rate. Under the alternative one arm differs. Until this was fixed, the alternative gave the differing arm and the rest independent Beta(0.5, 0.5) priors, so a control observed at 3% left the challenger free to sit anywhere in [0, 1] with no more prior weight near 3% than near 80%. A Bayes factor charges for that freedom. The charge is the prior density of the effect at zero, and with two independent priors that density is set by the width of the whole unit interval rather than by the size of any difference two creatives for one product could plausibly have.

The charge is large and it grows with the data. On two arms of 24,000 impressions sitting at exactly the same rate, the old Bayes factor is 7.28e-3. The evidence has to buy back a factor of 137 before the test can say anything at all, and at a 10% lift there is not that much evidence in 48,000 impressions.

One correction to the diagnosis, because it changes what the fix has to be. This is not a prior on the wrong scale for a base rate near 0.03. Measured on a tie at n=24,000, the old Bayes factor is 7.28e-3 at a 0.5% base rate, 7.28e-3 at 3%, 7.28e-3 at 20% and 7.28e-3 at 50%. Invariance under reparametrisation is the defining property of the Jeffreys prior and it is doing its job. The error is on the effect, not on the base rate.

That distinction is why the obvious repair does not work. Swapping Beta(0.5, 0.5) for Beta(3, 97) inside the Bayes factor roughly doubles power at a 3% base rate, and it does so only because Beta(3, 97) happens to be piled up at 3%. Move the cohort and it collapses. Same runs, 400 to a null cell and 200 to a power cell, horizon 48,000, twelve looks, alpha and the Ville bar untouched:

| scenario | allocation | Beta(0.5, 0.5) | Beta(3, 97) |
|---|---|---|---|
| null 3.0% vs 3.0% | even | 0.3% | 1.0% |
| null 3.0% vs 3.0% | thompson | 0.5% | 2.0% |
| null 50% vs 50% | even | 0.5% | 0.0% |
| power 3.0% to 3.3% | even | 3.5% | 14.5% |
| power 3.0% to 3.6% | even | 45.5% | 74.0% |
| power 3.0% to 4.0% | thompson | 4.5% | 38.5% |
| power 3.0% to 6.0% | thompson | 29.5% | 95.0% |
| power 20% to 22% | even | 93.0% | 17.0% |
| power 50% to 55% | even | 100.0% | 33.0% |
| power 50% to 55% | thompson | 10.0% | 0.5% |

The bottom three rows are the whole story. At a 50% base rate the median peak e-value under Beta(3, 97) is 1.6e-24. The prior that looks like a fix at 3% is a prior that has been told the answer, and a cohort of buttons or thumbnails at a 20% or 50% rate is not exotic.

What is in `bandit.ts` now. Both models draw a base rate from the same fixed mixture over a grid of rates spaced evenly on the log-odds scale, and under the alternative the differing arm and the rest share that draw. The prior on the difference then has a width of about sqrt(2p(1-p)/(k+1)) instead of the width of the unit interval, where p is wherever the cohort turns out to live and k is a concentration constant. Nothing about the prior depends on the data, so the Bayes factor is still a ratio of two proper marginal likelihoods and still a test martingale, which is what Ville's inequality needs. The tax stops being 7.28e-3 and becomes about 4.4e-2, at every base rate: 4.95e-2 at 0.5%, 4.34e-2 at 3%, 4.46e-2 at 20%, 4.50e-2 at 50%.

The concentration is the only new knob and it is set at 50, which is where the measurement puts it and not where it looks best. Power rises with k up to about 100 and then the prior starts insisting the arms are alike and shrinks real winners away. On 3.0% against 20% under Thompson, an effect nobody would call subtle, the gate fires 100% of the time at k=25 and k=50, 45% at k=100 and 0.5% at k=200. On 3.0% against 12% it is 100%, 100%, 96% and 18%. Fifty sits on the flat part of that curve with the collapse two steps away, not one.

We also had to pay for a claim we had been making loosely. An e-variable is a statistic whose expectation under the null is at most 1; that is what makes Ville's bound apply. Averaged over the model's own prior on the base rate this Bayes factor has expectation exactly 1 by construction, but at a fixed base rate it can drift above. Exact enumeration over both arms, not simulation, puts the worst drift at 1.28, at very low click rates with small samples. So the shipped e-value divides by 1.4. That constant costs about a quarter of the relief and buys the right to quote the bound without a footnote.

One smaller thing came out of the same review. The e-value used to be that Bayes factor multiplied by the probability of being best. Multiplying an e-variable by a number in [0, 1] leaves something that still cannot cross the boundary more often than the bound allows, so nothing was unsound, but the product is not an object anyone defines and the probability of being best is already its own gate two lines above it. It is gone, and `eValue` on the `Evaluation` is now the calibrated Bayes factor and nothing else. Because the gate demands a probability of being best over 0.95 anyway, the two can differ by at most 5%, and across the twenty-four null and power cells measured for the table below they differ in none of them.

Here is what the change does, on the same harness, 600 runs a null cell and 300 a power cell, two arms unless marked, horizon 48,000, twelve looks, alpha still 0.05 and the bar still 20.

| scenario | allocation | old prior | new prior |
|---|---|---|---|
| null 0.5% vs 0.5% | even | 0.0% | 0.2% |
| null 0.5% vs 0.5% | thompson | 0.0% | 2.3% |
| null 3.0% vs 3.0% | even | 0.2% | 0.5% |
| null 3.0% vs 3.0% | thompson | 0.5% | 1.8% |
| null 20% vs 20% | even | 0.2% | 0.7% |
| null 20% vs 20% | thompson | 1.3% | 2.0% |
| null 50% vs 50% | even | 0.3% | 0.7% |
| null 50% vs 50% | thompson | 1.0% | 1.2% |
| null 3.0%, four arms | even | 0.2% | 0.5% |
| null 3.0%, four arms | thompson | 0.0% | 0.2% |
| null 50%, four arms | thompson | 0.2% | 1.3% |
| null 0.5%, four arms | thompson | 0.0% | 0.3% |
| power 0.5% to 0.65% | even | 6.3% | 14.0% |
| power 0.5% to 0.65% | thompson | 0.0% | 4.3% |
| power 3.0% to 3.3% | even | 3.3% | 7.3% |
| power 3.0% to 3.6% | even | 46.0% | 60.0% |
| power 3.0% to 4.0% | even | 97.3% | 99.0% |
| power 3.0% to 4.0% | thompson | 5.0% | 14.3% |
| power 3.0% to 6.0% | thompson | 26.0% | 66.3% |
| power 20% to 22% | even | 93.3% | 97.7% |
| power 50% to 55% | even | 100.0% | 100.0% |
| power 50% to 55% | thompson | 11.3% | 32.0% |
| power 20% to 22% | thompson | 5.0% | 12.0% |

The false positive rate rises, and every null row in that table is a false positive since the arms are identical. That is not a side effect, it is the trade: the old gate was not running at 5%, it was running at a few tenths of a percent, and that unspent headroom is exactly what the new prior spends. The worst null cell is 2.3% and every null cell is under 5%, which was the condition for keeping the change. It is also where the five false winners in the power tables above came from, and where the one Thompson row that is now worse than never deciding came from. Both are the same bill.

What it buys is the row the section above called the design pulling against itself. On 3.0% against 6.0% under Thompson, the traffic shape banditd actually serves, the gate went from certifying a real winner one run in four to two runs in three. It does not fix the 10% lift under an even split, and nothing here should be read as claiming it does: 3.0% against 3.3% goes from 3.3% to 7.3% and that is still a gate that mostly does not fire. At that effect size and that horizon the evidence really is not there, and that remainder, the part left after the prior is fixed, is the price of the guarantee. The old sentence was not wrong because the idea was wrong. It was wrong because we had never measured how much of the bill belonged to it, and it turned out most of it did not.

Sections 10, 11 and 12 of `scripts/bandit-test.mts` print this: the Bayes factor under the old prior, the judge's Beta(3, 97) and the shipped one across four base rates, the exact enumeration behind the 1.4, and the old prior against the new one on the same runs. Section 12 runs at 150 runs a cell by default where the table above used 600 and 300, so its cells are noisier, but it is the same measurement on the same code.

The honest summary is that we published the error rate and left out the price. The gate protects against declaring a false winner, and that is what matters when the consequence is an automatic irreversible charge and a creative the seller then scales. The naive rule decides sooner, and that is what matters when being wrong is cheap and the traffic is split evenly whether you have made up your mind or not. Both of those are true at once. A seller whose mistakes compound wants this gate. A seller who would notice and reverse a bad call next week does not, and should say so with alpha.

The Monte Carlo size is 20000 samples, not 500. At 500 the Monte Carlo standard deviation of the probability estimate was 0.0094, and on one dataset sitting near the threshold, byte for byte identical every time, 200 reruns flipped the verdict 100 times. Half. At that point the estimator is the coin, not the data.

`scripts/bandit-test.mts` reproduces all of it: the Beta sampler checked against analytic moments, both null scenarios, the detection runs against known truth, the Monte Carlo noise measurement, the gate by gate breakdown on fixed datasets, the power curve under both allocations, the alpha sweep, the prior comparison, the exact calibration enumeration and the old prior against the new one. It prints the same tables the numbers above came from, in about ten minutes.

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

That first party limit is the reason we ran the loop once against a merchant that is not us, and wrote down what came back.

A human signed a mandate with a passkey for 60.00 USD, scoped to Allbirds and to nothing else. The agent charged 25.00 against it with no approval step, Prava issued a single use card for that one purchase, and that card was carried to allbirds.com, a store we do not run and have no relationship with, for an Anytime Ankle Sock at 16.00. Allbirds refused it: "Your payment details couldn't be verified." The agent then reported the real outcome back to Prava as DECLINED, and because the merchant never took the money the mandate came back whole.

```
mandate      mdt_01KZ0KP8EEDFRP425E74Y6HSJ0
merchant     Allbirds, scope listed
ceiling      60.00 USD, valid until 1 September 2026
transaction  txn_01KZ0KR2YPT13BEVZ9HGT4BF8N, 25.00 USD, failed
reported     DECLINED, Visa confirmation SUCCESS
after        60.00 USD remaining, 0 charges counted, mandate still active
```

Three things in that trace are worth separating. The refusal is the merchant's, not ours and not a rule we wrote. The DECLINED report is the agent telling the payment network the truth about a charge that did not land, which is the call this repository could not make at all until the last hours of the hackathon. And the mandate surviving intact is Prava, not us, deciding that a charge nobody honoured does not spend a cycle.

What it does not show is a completed purchase. A sandbox card on a live merchant is expected to be refused, and the hackathon's own production requirement asks for exactly this and says so: show a tokenized test card transaction on a real merchant, "we expect it to fail and it's accepted as a working sandbox flow". So the honest summary is that the agentic half of the loop reached an independent merchant and the commercial half did not complete, and the reason it did not complete is that the card was never meant to.

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

Does the money work? We cannot answer that honestly, so we are not going to pretend to. We have never run a paid campaign, we have no recovery figure of our own, and we are not going to manufacture one out of somebody else's estimate of how much advertising is wasted. What we can put a number on is the mistake: the naive rule calls a false winner 44.5% of the time and the four gates call one 2.5% of the time. A false winner is the expensive error, because a seller believes it and scales it. What a subscription buys is the ones that do not get made, and the seller knows better than we do what a scaled loser costs in their account.

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
