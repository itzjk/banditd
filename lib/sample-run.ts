export interface SampleAd {
  angle: string;
  headline: string;
  impressions: number;
  clicks: number;
  winner?: boolean;
}

export interface SampleFact {
  label: string;
  value: string;
  mono?: boolean;
}

export interface SampleCharge {
  id: string;
  ok: boolean;
  amount: string;
  code: string | null;
  title: string;
  attempt: string;
  said: string;
  ruling: string;
  check: string;
  facts: SampleFact[];
}

export const SAMPLE_PRODUCT = {
  name: "Cold-Pressed Coffee Concentrate",
  price: "$28.00",
  description: "A 32oz bottle of slow-steeped concentrate that makes 16 cups.",
  when: "2 August 2026",
};

export const SAMPLE_ADS: SampleAd[] = [
  {
    angle: "price",
    headline: "Sixteen cups for what two cost you outside",
    impressions: 3130,
    clicks: 166,
    winner: true,
  },
  {
    angle: "quality",
    headline: "Twenty hours of cold steeping in one bottle",
    impressions: 700,
    clicks: 17,
  },
  {
    angle: "ritual",
    headline: "Your morning starts before the queue does",
    impressions: 620,
    clicks: 13,
  },
  {
    angle: "gift",
    headline: "The bottle that makes anyone a coffee person",
    impressions: 550,
    clicks: 10,
  },
];

export const SAMPLE_CALL = {
  winnerAngle: "price",
  probabilityBest: "99.9%",
  impressions: 5000,
  clicks: 206,
  amount: "4.00",
  reason:
    "The price angle held a click rate near five percent across three thousand of the five thousand impressions while the other three sat close to two. The four gates cleared, so the agent bought the next round of renders on the winner instead of asking anyone.",
};

export const SAMPLE_CHARGES: SampleCharge[] = [
  {
    id: "sample_charged",
    ok: true,
    amount: "4.00",
    code: null,
    title: "Approved on the rail",
    attempt: "Four renders of the winning ad, bought at one dollar each.",
    said: "",
    ruling: "The mandate allowed it and the money moved.",
    check:
      "This order sits in the Prava dashboard as a Visa mandate charge that reached Creds_Generated, the point where the network hands over a single use card. Order and reference are printed here so the claim can be checked against Prava's own record rather than taken from this page.",
    facts: [
      { label: "Order", value: "ord_01KZ085GMNRTHFW216PGWFG7DP", mono: true },
      { label: "Reference", value: "banditd_verify_1785641222", mono: true },
      { label: "Merchant", value: "Banditd Render Credits" },
      { label: "Card", value: "Single use Visa" },
      { label: "Mandate", value: "Recurring monthly, $50.00 ceiling" },
      { label: "Valid until", value: "1 September 2026" },
    ],
  },
  {
    id: "sample_threshold",
    ok: false,
    amount: "50.00",
    code: "THRESHOLD_EXCEEDED",
    title: "Over the ceiling the seller signed",
    attempt: "Fifty dollars asked against a mandate the seller signed at five.",
    said: "Visa did not return COMPLETED (status DECLINED): Total amount 50.00 exceeds threshold 5.00 in current payment cycle",
    ruling:
      "A rule on the mandate refused this. No money moved, and the mandate stayed alive for a smaller charge.",
    check:
      "The line above is the string the Visa network returned through Prava, copied as it arrived. Our code did not block the charge, it sent it and the network said no.",
    facts: [
      { label: "Merchant", value: "Banditd Render Credits" },
      { label: "Cap on the mandate", value: "$5.00 per cycle" },
      { label: "Funds moved", value: "$0.00" },
    ],
  },
  {
    id: "sample_merchant",
    ok: false,
    amount: "4.00",
    code: "MANDATE_MERCHANT_NOT_ALLOWED",
    title: "Merchant outside the mandate",
    attempt: "Render credits charged against the mandate the seller signed for Allbirds.",
    said: "Merchant not allowed for this mandate: Banditd Render Credits",
    ruling: "A rule on the mandate refused this. No money moved.",
    check:
      "The line above is the string Prava returned, copied as it arrived. A mandate names one merchant and the network holds that line, not our code.",
    facts: [
      { label: "Merchant asked for", value: "Banditd Render Credits" },
      { label: "Merchant on the mandate", value: "Allbirds" },
      { label: "Funds moved", value: "$0.00" },
    ],
  },
];

export const SAMPLE_TOTALS = {
  spent: "4.00",
  blocked: "54.00",
  charges: "1 of 3",
};
