import { buildSnapshot, renderSnapshot, scriptedNext, PLAN_ACTIONS } from "../lib/plan.ts";
import type { PlanMandate, PlanProgress, PlanSnapshot } from "../lib/plan.ts";
import { emptyState } from "../lib/state-schema.ts";
import { chooseNextAction, startBudget, failureBody } from "../lib/openai.ts";
import type { State, Creative, CreativeAngle } from "../lib/state-schema.ts";

const ACTION_DESCRIPTION: Record<string, string> = {
  research:
    "Read the live web for who buys this product, what angles competitors run and where the price sits. Writes the buyer profile the creatives are written from.",
  creatives:
    "Write four fresh ad variants with images and load them into the bandit as a new generation. Refused if there is no research yet.",
  serve_traffic:
    "Run the simulated auction and allocate a block of impressions across the live variants by Thompson sampling, then re-read the four gates. Say how many impressions in the impressions field. A useful block is between 2,000 and 20,000, and it is split across the live variants, so the leader only receives part of it while the traffic gate counts the leader alone. Each block costs one cycle, so a block far too small burns a cycle without moving the evidence.",
  evaluate:
    "Re-read the posteriors and ask for a justified verdict on whether the leading variant has earned the spend. Only worth doing after new traffic has landed.",
  purchase:
    "Charge the seller's signed mandate for one pack of render credits. The server recomputes the four gates and Prava enforces the mandate, so this is refused unless the evidence and the mandate both allow it. The amount charged and the justification written on the receipt are the ones the last evaluate produced, so charging without a fresh spend decision on the current evidence buys blind and leaves the seller a receipt with no reason on it.",
  evolve:
    "Breed four mutations of the winning variant into the next generation. Only useful once a charge has paid for the render credits they burn.",
  stop: "End the run here and say why. Use this when nothing left to do would change the outcome.",
};

const ANGLES: CreativeAngle[] = ["price", "ritual", "gift", "quality"];
const HEADS = [
  "Sixteen cups from one bottle",
  "The two minute morning",
  "The gift that gets used daily",
  "Slow steeped for eighteen hours",
];

function creative(i: number, impressions: number, clicks: number, generation = 0): Creative {
  return {
    id: `cr_test_${generation}_${i}`,
    generation,
    parentId: null,
    angle: ANGLES[i % 4],
    headline: HEADS[i % 4],
    body: "Cold pressed concentrate, sixteen cups a bottle.",
    imagePrompt: "",
    targetEmotion: "",
    imageData: null,
    arm: { impressions, clicks },
  };
}

function baseState(): State {
  const s = emptyState();
  s.product = {
    name: "Cold-Pressed Coffee Concentrate",
    price: "$28.00",
    description: "A 32oz bottle of slow-steeped concentrate that makes 16 cups.",
  };
  s.mandateId = "mnd_test";
  return s;
}

function withResearch(s: State): State {
  s.research = {
    buyerProfile: "Home coffee drinkers who already own a grinder and want speed without losing quality.",
    competitorAngles: ["price per cup", "ritual", "gifting"],
    pricePositioning: "Sits above supermarket concentrate and below specialty subscription.",
    sources: [
      { title: "Source one", url: "https://example.com/a" },
      { title: "Source two", url: "https://example.com/b" },
      { title: "Source three", url: "https://example.com/c" },
    ],
  };
  return s;
}

const OPEN_MANDATE: PlanMandate = {
  chargeable: 2,
  remaining: "2 signed mandate(s) still chargeable this cycle, 50.00 USD total left on them",
  note: "One charge per mandate per monthly cycle.",
};

const SPENT_MANDATE: PlanMandate = {
  chargeable: 0,
  remaining: "no signed mandate is chargeable in this cycle",
  note: "A Prava mandate on a monthly frequency allows one charge per cycle, and every signed mandate is already charged in this one. A purchase now will be refused, no money can move until the seller signs another mandate.",
};

function progress(over: Partial<PlanProgress> = {}): PlanProgress {
  return {
    researched: false,
    wrote: false,
    decided: false,
    purchaseAttempts: 0,
    purchased: false,
    evolved: false,
    retested: false,
    looksTaken: 0,
    looksLeft: 12,
    ...over,
  };
}

interface Case {
  name: string;
  expect: string[];
  snapshot: PlanSnapshot;
}

const cases: Case[] = [];

{
  const s = baseState();
  cases.push({
    name: "empty state, nothing done",
    expect: ["research"],
    snapshot: buildSnapshot({
      state: s,
      cycle: 1,
      progress: progress(),
      history: [],
      mandate: OPEN_MANDATE,
      creditPrice: "4.00",
      lastDecision: null,
      lastPurchase: null,
    }),
  });
}

{
  const s = withResearch(baseState());
  cases.push({
    name: "research done, no creatives",
    expect: ["creatives"],
    snapshot: buildSnapshot({
      state: s,
      cycle: 2,
      progress: progress({ researched: true }),
      history: ["researched the market off 3 live sources"],
      mandate: OPEN_MANDATE,
      creditPrice: "4.00",
      lastDecision: null,
      lastPurchase: null,
    }),
  });
}

{
  const s = withResearch(baseState());
  s.creatives = [0, 1, 2, 3].map((i) => creative(i, 0, 0));
  cases.push({
    name: "creatives written, zero traffic",
    expect: ["serve_traffic"],
    snapshot: buildSnapshot({
      state: s,
      cycle: 3,
      progress: progress({ researched: true, wrote: true }),
      history: ["researched the market off 3 live sources", "wrote 4 creatives into generation 0"],
      mandate: OPEN_MANDATE,
      creditPrice: "4.00",
      lastDecision: null,
      lastPurchase: null,
    }),
  });
}

{
  const s = withResearch(baseState());
  s.creatives = [
    creative(0, 120, 5),
    creative(1, 90, 3),
    creative(2, 80, 3),
    creative(3, 70, 2),
  ];
  cases.push({
    name: "traffic served but not enough, gates shut",
    expect: ["serve_traffic", "evaluate"],
    snapshot: buildSnapshot({
      state: s,
      cycle: 4,
      progress: progress({ researched: true, wrote: true, decided: true, looksTaken: 2, looksLeft: 10 }),
      history: [
        "wrote 4 creatives into generation 0",
        "served traffic to look 2, 360 impressions on the board, still shut on \"Enough traffic\"",
        "read the evidence and held the money",
      ],
      mandate: OPEN_MANDATE,
      creditPrice: "4.00",
      lastDecision: "held the money: the leader has 120 impressions and the gate needs 200",
      lastPurchase: null,
    }),
  });
}

{
  const s = withResearch(baseState());
  s.creatives = [
    creative(0, 9000, 630),
    creative(1, 3000, 96),
    creative(2, 2600, 78),
    creative(3, 2400, 70),
  ];
  cases.push({
    name: "evidence sufficient, mandate open, no decision yet",
    expect: ["evaluate"],
    snapshot: buildSnapshot({
      state: s,
      cycle: 5,
      progress: progress({ researched: true, wrote: true, looksTaken: 4, looksLeft: 8 }),
      history: [
        "wrote 4 creatives into generation 0",
        "served traffic to look 4, 17000 impressions on the board, all four gates opened",
      ],
      mandate: OPEN_MANDATE,
      creditPrice: "4.00",
      lastDecision: null,
      lastPurchase: null,
    }),
  });
}

{
  const s = withResearch(baseState());
  s.creatives = [
    creative(0, 9000, 630),
    creative(1, 3000, 96),
    creative(2, 2600, 78),
    creative(3, 2400, 70),
  ];
  s.credits = { balance: 0, entries: [] };
  cases.push({
    name: "no render credits left, evidence sufficient",
    expect: ["purchase", "evaluate"],
    snapshot: buildSnapshot({
      state: s,
      cycle: 6,
      progress: progress({ researched: true, wrote: true, decided: true, looksTaken: 4, looksLeft: 8 }),
      history: [
        "served traffic to look 4, 17000 impressions on the board, all four gates opened",
        "read the evidence and cleared a spend of 4.00",
      ],
      mandate: OPEN_MANDATE,
      creditPrice: "4.00",
      lastDecision: "cleared a spend of 4.00: the price angle is best on 9000 impressions",
      lastPurchase: null,
    }),
  });
}

{
  const s = withResearch(baseState());
  s.creatives = [
    creative(0, 9000, 630),
    creative(1, 3000, 96),
    creative(2, 2600, 78),
    creative(3, 2400, 70),
  ];
  cases.push({
    name: "no mandate chargeable this cycle, evidence sufficient",
    expect: ["stop", "evolve"],
    snapshot: buildSnapshot({
      state: s,
      cycle: 7,
      progress: progress({
        researched: true,
        wrote: true,
        decided: true,
        purchaseAttempts: 1,
        looksTaken: 4,
        looksLeft: 8,
      }),
      history: [
        "served traffic to look 4, 17000 impressions on the board, all four gates opened",
        "read the evidence and cleared a spend of 4.00",
        "the charge did not go through, code NO_MANDATE_AVAILABLE",
      ],
      mandate: SPENT_MANDATE,
      creditPrice: "4.00",
      lastDecision: "cleared a spend of 4.00: the price angle is best on 9000 impressions",
      lastPurchase: "the mandate did not pay, code NO_MANDATE_AVAILABLE",
    }),
  });
}

const only = process.argv[2] ? Number(process.argv[2]) : null;
let matched = 0;
let ran = 0;
const timings: number[] = [];

for (const [index, item] of cases.entries()) {
  if (only !== null && only !== index) continue;
  ran += 1;
  console.log(`\n=== case ${index}: ${item.name}`);
  console.log(
    `    gates: ${
      item.snapshot.gates
        ? `${item.snapshot.gates.allOpen ? "all open" : `shut on ${item.snapshot.gates.blocking}`}, pbest ${(item.snapshot.gates.probabilityBest * 100).toFixed(1)}%, e ${item.snapshot.gates.eValue.toFixed(2)}, leader ${item.snapshot.gates.leaderImpressions} imps`
        : "no cohort"
    }`,
  );
  console.log(`    script would take: ${scriptedNext(item.snapshot).action}`);

  const t0 = Date.now();
  let picked;
  try {
    picked = await chooseNextAction(
      { actions: PLAN_ACTIONS, descriptions: ACTION_DESCRIPTION, briefing: renderSnapshot(item.snapshot) },
      startBudget("The next action", 60000),
    );
  } catch (e) {
    console.log("    MODEL FAILED", JSON.stringify(failureBody(e).body));
    continue;
  }
  const took = Date.now() - t0;
  timings.push(took);

  const ok = picked.action !== null && item.expect.includes(picked.action);
  if (ok) matched += 1;
  console.log(`    model chose: ${picked.action}${picked.impressions ? ` (${picked.impressions} impressions)` : ""} in ${(took / 1000).toFixed(1)}s ${ok ? "[in range]" : "[OUT OF RANGE, expected " + item.expect.join(" or ") + "]"}`);
  console.log(`    reason: ${picked.reason}`);
}

console.log(
  `\n${matched} of ${ran} inside the expected set. model latency: min ${Math.min(...timings) / 1000}s, max ${Math.max(...timings) / 1000}s, mean ${(timings.reduce((a, b) => a + b, 0) / timings.length / 1000).toFixed(1)}s`,
);
