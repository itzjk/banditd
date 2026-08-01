const BASE_URL = process.env.PRAVA_BASE_URL ?? "https://sandbox.api.prava.space";

function secretKey(): string {
  const key = process.env.PRAVA_SECRET_KEY;
  if (!key) throw new Error("PRAVA_SECRET_KEY is not set");
  return key;
}

export class PravaError extends Error {
  code: string;
  status: number;
  body: unknown;

  constructor(message: string, code: string, status: number, body: unknown) {
    super(message);
    this.name = "PravaError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

type Json = Record<string, unknown>;

async function call<T>(path: string, method: "GET" | "POST", body?: Json): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const obj = (parsed ?? {}) as Json;
    const err = (obj.error ?? obj) as Json;
    const code = String(err.code ?? err.errorCode ?? `HTTP_${res.status}`);
    const message = String(err.message ?? err.errorMessage ?? res.statusText);
    throw new PravaError(message, code, res.status, parsed);
  }

  return parsed as T;
}

export type MerchantScope = "any" | "listed";

export interface CreateMandateSessionInput {
  userId: string;
  userEmail: string;
  amount: string;
  currency?: string;
  merchantName: string;
  merchantUrl: string;
  merchantCountry: string;
  productDescription: string;
  merchantScope: MerchantScope;
  maxCharges: number;
  validUntil: string;
  recurringFrequency: "one_time" | "weekly" | "monthly" | "yearly";
}

export interface MandateSession {
  session_id: string;
  session_token: string;
  iframe_url: string;
  order_id?: string;
  expires_at?: string;
  authorizeOnly?: boolean;
}

export async function createMandateSession(input: CreateMandateSessionInput): Promise<MandateSession> {
  return call<MandateSession>("/v1/sessions", "POST", {
    user_id: input.userId,
    user_email: input.userEmail,
    total_amount: input.amount,
    currency: input.currency ?? "USD",
    purchase_context: [
      {
        merchant_details: {
          name: input.merchantName,
          url: input.merchantUrl,
          country_code_iso2: input.merchantCountry,
        },
        product_details: [
          {
            description: input.productDescription,
            unit_price: input.amount,
            quantity: 1,
          },
        ],
      },
    ],
    mandate_setup: {
      intent: "mandate_setup",
      merchant_scope: input.merchantScope,
      max_charges: input.maxCharges,
      valid_until: input.validUntil,
      recurring_frequency: input.recurringFrequency,
    },
  });
}

export interface Mandate {
  id: string;
  status: "pending" | "active" | "paused" | "consumed" | "cancelled" | "expired";
  state?: "available" | "consumed" | "expired";
  approvedAmount?: string;
  remaining?: string;
  recurringFrequency?: string;
  validUntil?: string;
  renewsAt?: string;
  merchantScope?: string;
  maxCharges?: number;
}

export async function listMandates(customerId?: string): Promise<Mandate[]> {
  const query = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : "";
  const res = await call<Mandate[] | { data?: Mandate[]; mandates?: Mandate[] }>(
    `/v1/mandates${query}`,
    "GET",
  );
  if (Array.isArray(res)) return res;
  return res.data ?? res.mandates ?? [];
}

export async function getMandate(id: string): Promise<Mandate> {
  const res = await call<Mandate | { data?: Mandate; mandate?: Mandate }>(`/v1/mandates/${id}`, "GET");
  const obj = res as { data?: Mandate; mandate?: Mandate };
  return obj.data ?? obj.mandate ?? (res as Mandate);
}

export interface ChargeCredentials {
  token: string;
  dynamicCvv: string;
  expiryMonth: string;
  expiryYear: string;
}

export interface ChargeSuccess {
  ok: true;
  mandateId: string;
  transactionId: string;
  orderId?: string;
  instructionId?: string;
  status: string;
  credentials: ChargeCredentials;
  deduplicated: boolean;
}

export interface ChargeFailure {
  ok: false;
  code: string;
  message: string;
  httpStatus: number;
  mandateId?: string;
  transactionId?: string;
}

export type ChargeResult = ChargeSuccess | ChargeFailure;

interface RawCharge {
  mandateId?: string;
  instructionId?: string;
  transactionId?: string;
  orderId?: string;
  status?: string;
  fetchStatus?: string;
  credentials?: ChargeCredentials;
  deduplicated?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

function declineCode(rawCode: string | undefined, message: string): string {
  const text = message.toLowerCase();
  if (text.includes("exceeds threshold")) return "THRESHOLD_EXCEEDED";
  if (text.includes("already made in the current payment cycle")) return "CYCLE_ALREADY_CHARGED";
  return rawCode ?? "CHARGE_FAILED";
}

export async function chargeMandate(
  mandateId: string,
  amount: string,
  reference: string,
): Promise<ChargeResult> {
  let raw: RawCharge;
  try {
    raw = await call<RawCharge>(`/v1/mandates/${mandateId}/charge`, "POST", {
      amount,
      reference,
    });
  } catch (e) {
    if (e instanceof PravaError) {
      return { ok: false, code: e.code, message: e.message, httpStatus: e.status, mandateId };
    }
    throw e;
  }

  if (raw.status === "failed" || !raw.credentials) {
    const message = raw.errorMessage ?? "Charge was declined";
    return {
      ok: false,
      code: declineCode(raw.errorCode, message),
      message,
      httpStatus: 200,
      mandateId: raw.mandateId ?? mandateId,
      transactionId: raw.transactionId,
    };
  }

  return {
    ok: true,
    mandateId: raw.mandateId ?? mandateId,
    transactionId: raw.transactionId ?? "",
    orderId: raw.orderId,
    instructionId: raw.instructionId,
    status: raw.status ?? "awaiting_result",
    credentials: raw.credentials,
    deduplicated: Boolean(raw.deduplicated),
  };
}

export interface ReportResult {
  mandateId: string;
  transactionId: string;
  orderId?: string;
  status: string;
  mandateStatus?: string;
  visaConfirmation?: string;
}

export async function reportCharge(
  mandateId: string,
  txnId: string,
  approved: boolean,
  amountPaid?: string,
): Promise<ReportResult> {
  return call<ReportResult>(`/v1/mandates/${mandateId}/charges/${txnId}/report`, "POST", {
    txn_status: approved ? "APPROVED" : "DECLINED",
    txn_type: "PURCHASE",
    ...(amountPaid ? { amount_paid: amountPaid } : {}),
  });
}
