import {
  createMandateSession,
  listMandates,
  chargeMandate,
  reportCharge,
  PravaError,
} from "../lib/prava.ts";

const MERCHANT = {
  name: process.env.RENDER_MERCHANT_NAME ?? "Banditd Render Credits",
  url: process.env.RENDER_MERCHANT_URL ?? "https://render.banditd.dev",
  country: process.env.RENDER_MERCHANT_COUNTRY ?? "US",
};

function validUntil(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

async function setup() {
  const session = await createMandateSession({
    userId: process.env.PRAVA_USER_ID ?? "seller_demo_1",
    userEmail: process.env.PRAVA_USER_EMAIL ?? "seller@banditd.dev",
    amount: process.env.MANDATE_CAP ?? "50.00",
    merchantName: MERCHANT.name,
    merchantUrl: MERCHANT.url,
    merchantCountry: MERCHANT.country,
    productDescription: "Ad creative render credits",
    merchantScope: MERCHANT.url,
    maxCharges: 10,
    validUntil: validUntil(30),
    recurringFrequency: "monthly",
  });

  console.log("session_id     ", session.session_id);
  console.log("authorizeOnly  ", session.authorizeOnly);
  console.log("expires_at     ", session.expires_at);
  console.log("");
  console.log("Open this URL and approve with your passkey:");
  console.log(session.iframe_url);
}

async function list() {
  const mandates = await listMandates(process.env.PRAVA_USER_ID ?? "seller_demo_1");
  if (!mandates.length) {
    console.log("no mandates yet");
    return;
  }
  for (const m of mandates) {
    console.log(
      [m.id, m.status, m.state ?? "", m.approvedAmount ?? "", m.remaining ?? "", m.validUntil ?? ""].join(
        "  ",
      ),
    );
  }
}

async function charge(mandateId: string, amount: string) {
  const reference = `banditd_smoke_${Date.now()}`;
  const result = await chargeMandate(mandateId, amount, reference);

  if (!result.ok) {
    console.log("CHARGE FAILED");
    console.log("  code    ", result.code);
    console.log("  message ", result.message);
    console.log("  http    ", result.httpStatus);
    return;
  }

  console.log("CHARGE OK");
  console.log("  transactionId ", result.transactionId);
  console.log("  status        ", result.status);
  console.log("  deduplicated  ", result.deduplicated);
  console.log("  card last4    ", result.credentials.token.slice(-4));
  console.log("  dynamicCvv    ", result.credentials.dynamicCvv ? "present" : "missing");
  console.log("  expiry        ", `${result.credentials.expiryMonth}/${result.credentials.expiryYear}`);

  const reported = await reportCharge(mandateId, result.transactionId, true, amount);
  console.log("REPORTED");
  console.log("  status        ", reported.status);
  console.log("  mandateStatus ", reported.mandateStatus);
  console.log("  visa          ", reported.visaConfirmation);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "setup") return await setup();
    if (cmd === "list") return await list();
    if (cmd === "charge") {
      const [id, amount] = rest;
      if (!id) throw new Error("usage: charge <mandate_id> [amount]");
      return await charge(id, amount ?? "4.00");
    }
    console.log("usage: setup | list | charge <mandate_id> [amount]");
  } catch (e) {
    if (e instanceof PravaError) {
      console.error(`PravaError ${e.status} ${e.code}: ${e.message}`);
      console.error(JSON.stringify(e.body, null, 2));
      process.exit(1);
    }
    throw e;
  }
}

main();
