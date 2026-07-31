banditd

An agent that runs ads for you and spends its own money on the ones that work.

Built at the Agentic Commerce Hackathon, Jul 31 – Aug 2 2026.

Why

If you sell anything online you know the drill. You make twenty creatives, two of them actually convert, and you figure out which two after you've already burned the budget on the other eighteen.

banditd just does that part for you.

How it works

You paste in a product. Name, price, a sentence about it.

The agent looks up who buys this kind of thing and what everyone else is saying about it, then writes four different creatives — different angles, different images, different copy. It watches how they do. Once one of them is clearly winning it buys more render credits through Prava, by itself, and makes more of that one.

No approval step. No "hey, can I spend $4?" It just goes, inside the limits you set.

The limits

You give it a mandate before it can touch anything:

- max spend
- what it's allowed to buy
- when the permission expires
- a Face ID tap to turn it on

Dashboard shows what's left, why it bought each thing, and the single-use card it burned doing it. The card number never touches the agent.

If it tries to go over, it gets blocked and tells you why. That's in the demo on purpose — showing the thing fail is more convincing than showing it succeed.

About the "clearly winning" part

"Buy when CTR is over 4%" is a number someone made up. First thing anyone asks is what if it was luck.

So each creative is an arm on a multi-armed bandit and the agent runs Thompson sampling over them. It only spends when it's 95% sure the leader is actually the leader, with enough impressions behind it. Same approach real ad platforms use. Handles the luck question on its own.

OpenAI

Three things, all doing real work:

Web search for the market research. Structured outputs so the creative specs come back as JSON I can feed straight into the render pipeline. Function calling for the spend decision itself — the model gets the bandit state and the mandate rules and either calls `purchase_render_credits(amount, reason)` or doesn't. That reason string is what shows up on the dashboard.

Prava

session → mandate → passkey → single-use token → charge

Runs on Prava's API/SDK. Their stack sits on Visa Intelligent Commerce, which is the part that makes an agent-initiated card charge work at all under a mandate you can revoke.

Stack

Next.js, TypeScript, Tailwind, OpenAI, Prava SDK, deployed on Vercel.

Running it

```bash
git clone https://github.com/itzjk/banditd
cd banditd
npm install
cp .env.example .env.local
npm run dev
```

You'll need:

```
OPENAI_API_KEY=
PRAVA_PUBLISHABLE_KEY=pk_test_...
PRAVA_SECRET_KEY=sk_test_...
```

What's next

Right now it's one seller, creative generation, and buying render credits.

After that: actual ad spend instead of just credits, live competitor tracking, generated video scripts.

Where it goes: the whole thing runs the store. Sourcing, pricing, catalog.

Disclosure

Design, architecture and reading through the Prava and OpenAI docs happened before the event. All the code here was written during the hackathon — repo was created empty before kickoff, commit history shows the build.

Performance numbers in the demo are simulated and labeled that way in the UI. Payments are sandbox.

Who

[@itzjk](https://github.com/itzjk)

MIT
