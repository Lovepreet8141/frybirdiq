/**
 * Razorpay. BUILD-PLAN.md §3, §45; roadmap 1.1.
 *
 * The second implementation of `PaymentProvider`, and the order service
 * does not change for it — which is the whole point of writing the
 * interface before there was a gateway to hide behind it.
 *
 * What this module does: creates a Razorpay Order for exactly the paise the
 * server says is due, verifies the signature Razorpay Checkout hands back,
 * verifies webhook signatures, and asks Razorpay for a refund. What it never
 * does: touch the database, decide an order's status, or trust an amount
 * that came from a browser.
 *
 * The REST calls use `fetch` with HTTP Basic auth (key id : key secret) —
 * no SDK, so there is nothing between this file and the wire to audit. All
 * signature checks are HMAC-SHA256 compared in constant time.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { type Paise, ZERO, paise } from "@/lib/money";
import {
  type CaptureFailureCode,
  type PaymentIntent,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentResult,
  type RefundLookup,
  type RefundResult,
  type WebhookVerification,
} from "./provider";

export const RAZORPAY_PROVIDER = "razorpay";
const API = "https://api.razorpay.com/v1";

export interface RazorpayConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string | null;
}

/**
 * Reads the keys from the environment, or null when Razorpay is not set up.
 *
 * Read directly rather than through `serverEnv()` so `availableMethods()` can
 * answer "is online payment on?" from a Server Component and from tests
 * without the whole server env being present; the keys are declared optional
 * in `src/lib/env` and documented in `.env.example`.
 */
export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || null };
}

export function isRazorpayConfigured(): boolean {
  return razorpayConfig() !== null;
}

/* ------------------------------------------------------------------ */
/* Pure signature helpers — tested with recorded fixtures              */
/* ------------------------------------------------------------------ */

function hmac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** What Razorpay Checkout signs on success: `order_id|payment_id` with the key secret. */
export function paymentSignature(input: { providerOrderId: string; providerPaymentId: string; keySecret: string }): string {
  return hmac(input.keySecret, `${input.providerOrderId}|${input.providerPaymentId}`);
}

export function verifyPaymentSignature(input: { providerOrderId: string; providerPaymentId: string; signature: string; keySecret: string }): boolean {
  return safeEqualHex(paymentSignature(input), input.signature.trim().toLowerCase());
}

/** Webhooks are signed over the raw request body with the webhook secret. */
export function verifyWebhookSignature(input: { body: string; signature: string; webhookSecret: string }): boolean {
  return safeEqualHex(hmac(input.webhookSecret, input.body), input.signature.trim().toLowerCase());
}

/** Razorpay's amounts are integer paise in a JSON number. Ours are bigint paise; the conversion refuses anything that would not survive it. */
export function toRazorpayAmount(amount: Paise): number {
  if (amount <= ZERO) throw new RangeError(`razorpay: cannot charge ${amount.toString()} paise`);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("razorpay: amount is too large");
  return Number(amount);
}

/** The method Razorpay reports on a payment, mapped onto ours. */
export function methodFromRazorpay(method: string | null | undefined): PaymentMethod {
  switch (method) {
    case "upi":
      return "UPI";
    case "card":
      return "CARD";
    case "netbanking":
      return "NETBANKING";
    case "wallet":
      return "WALLET";
    default:
      return "OTHER";
  }
}

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

interface RazorpayOrder {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
}

export interface RazorpayPayment {
  readonly id: string;
  readonly order_id: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly status: "created" | "authorized" | "captured" | "refunded" | "failed";
  readonly method: string;
  readonly fee: number | null;
  readonly tax: number | null;
  readonly email?: string;
  readonly contact?: string;
  readonly error_description?: string | null;
}

export interface RazorpayRefund {
  readonly id: string;
  readonly payment_id?: string;
  readonly amount: number;
  readonly currency?: string;
  /** "pending" → "processed", or "failed". */
  readonly status: string;
  readonly notes?: Record<string, unknown> | unknown[] | null;
}

/**
 * Every Razorpay call gives up after this long; a refund that times out is
 * ambiguous, never assumed.
 *
 * Kept below `withIdempotency`'s 10 s in-flight wait (RELIABILITY C3), so a
 * caller that takes over a silent claim normally finds the first POST
 * already finished. Correctness does not rest on the timing: a takeover
 * resumes the same RESERVED row and sends the same X-Refund-Idempotency (the
 * row id), and Razorpay answers a concurrent same-key request with 409,
 * which is ambiguous — never a second refund. Keep that invariant.
 */
export const RAZORPAY_TIMEOUT_MS = 8_000;

type CallResult<T> = { ok: true; data: T; status: number } | { ok: false; error: string; status: number | null };

async function call<T>(
  config: RazorpayConfig,
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> },
): Promise<CallResult<T>> {
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...init?.headers },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: `Razorpay could not be reached (${error instanceof Error ? error.message : "network error"}).`, status: null };
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const description = (data as { error?: { description?: string } } | null)?.error?.description;
    return { ok: false, error: description ? `Razorpay: ${description}` : `Razorpay returned ${response.status}.`, status: response.status };
  }
  return { ok: true, data: data as T, status: response.status };
}

/**
 * The note that ties a Razorpay refund to our refund row. Written on every
 * refund request, and what a resumed refund looks for before asking again.
 */
export const REFUND_ROW_NOTE = "frybirdRefundId";

/** The request body for a refund — built only from the reserved row, so a repeat is byte-identical (Razorpay answers a changed body under the same key with 409). */
export function refundRequestBody(input: { amount: Paise; reason: string; refundId: string }): { amount: number; notes: Record<string, string> } {
  return { amount: toRazorpayAmount(input.amount), notes: { reason: input.reason.slice(0, 250), [REFUND_ROW_NOTE]: input.refundId } };
}

/**
 * A refund object Razorpay returned, classified. "processed" is money back;
 * "pending" is accepted but not finished — it must stay reserved (ref-2
 * condition); "failed" is refused. Anything else, or a refund for another
 * amount than asked, is ambiguous: never booked, never released.
 */
export function classifyRazorpayRefund(refund: RazorpayRefund, expectedAmount: Paise, httpStatus: number | null): RefundResult {
  const base = { providerRefundId: refund.id ?? null, refundedAmount: ZERO, httpStatus };
  const amountMatches = Number.isSafeInteger(refund.amount) && BigInt(refund.amount) === expectedAmount && (refund.currency === undefined || refund.currency === "INR");
  switch (refund.status) {
    case "processed":
      return amountMatches
        ? { ...base, outcome: "succeeded", refundedAmount: paise(refund.amount) }
        : { ...base, outcome: "ambiguous", error: "Razorpay refunded a different amount than was asked. Check the Razorpay dashboard before doing anything else." };
    case "pending":
      return { ...base, outcome: "pending", error: "Razorpay has accepted the refund and is still processing it." };
    case "failed":
      return { ...base, outcome: "refused", error: "Razorpay could not make the refund." };
    default:
      return { ...base, outcome: "ambiguous", error: `Razorpay reported the refund as ${String(refund.status)}.` };
  }
}

/**
 * A failed refund call, classified by what it proves (S5). A 4xx other than
 * 409 and 429 carries Razorpay's own refusal: no money moved. A 409 (the key
 * is in progress, or reused with another body), a 429, a 5xx, a timeout or a
 * network error proves nothing — ambiguous.
 */
export function classifyRazorpayRefundFailure(error: string, httpStatus: number | null): RefundResult {
  const definitive = httpStatus !== null && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 409 && httpStatus !== 429;
  return { outcome: definitive ? "refused" : "ambiguous", providerRefundId: null, refundedAmount: ZERO, httpStatus, error };
}

function noteOf(refund: RazorpayRefund): string | null {
  const notes = refund.notes;
  if (!notes || Array.isArray(notes)) return null;
  const value = notes[REFUND_ROW_NOTE];
  return typeof value === "string" ? value : null;
}

export async function fetchRazorpayPayment(
  config: RazorpayConfig,
  providerPaymentId: string,
): Promise<{ ok: true; payment: RazorpayPayment } | { ok: false; error: string; status: number | null }> {
  const result = await call<RazorpayPayment>(config, `/payments/${encodeURIComponent(providerPaymentId)}`);
  return result.ok ? { ok: true, payment: result.data } : result;
}

/**
 * A failed fetch is worth asking again when nobody answered, or the gateway
 * itself failed or throttled, or OUR credentials were refused. A 401 or 403 is
 * a wrong, rotated or test/live-mismatched key pair: the money may well have
 * been taken and nothing here has judged the payment at all, so it must stay
 * retryable. Answering it as a final decline made the webhook mark the event
 * processed and the money was never recorded, not even as a refundable row.
 * Only a payment Razorpay itself answered about (a 4xx for THIS payment, such
 * as 404 not found) is a final answer.
 */
function fetchFailureCode(status: number | null): CaptureFailureCode {
  return status === null || status >= 500 || status === 429 || status === 408 || status === 401 || status === 403 ? "GATEWAY_UNAVAILABLE" : "GATEWAY_DECLINED";
}

/* ------------------------------------------------------------------ */
/* The provider                                                        */
/* ------------------------------------------------------------------ */

function unavailable(): PaymentResult {
  return { ok: false, providerPaymentId: null, capturedAmount: ZERO, error: "Online payment is not set up.", code: "GATEWAY_UNAVAILABLE" };
}

export const razorpayProvider: PaymentProvider = {
  name: RAZORPAY_PROVIDER,
  supportedMethods: ["UPI", "CARD", "NETBANKING", "WALLET"],

  /**
   * Creates the Razorpay Order the customer will pay against. The amount is
   * the server's figure for the order — nothing the browser sent — and the
   * receipt carries our order id so a Razorpay dashboard entry can always be
   * traced back.
   */
  async createIntent({ orderId, amount, method }): Promise<PaymentIntent> {
    const config = razorpayConfig();
    if (!config) throw new Error("razorpay: not configured");
    const created = await call<RazorpayOrder>(config, "/orders", {
      method: "POST",
      body: { amount: toRazorpayAmount(amount), currency: "INR", receipt: orderId, notes: { orderId } },
    });
    if (!created.ok) throw new Error(created.error);
    return { orderId, amount, method, providerOrderId: created.data.id, requiresCustomerAction: true };
  },

  /**
   * Confirms that Razorpay actually took the money.
   *
   * Two ways in, both verified against Razorpay rather than the browser:
   * with a Checkout signature (HMAC over `order_id|payment_id`), or — for a
   * webhook, which has no per-payment signature — by fetching the payment
   * from Razorpay and reading its status. In both cases the amount Razorpay
   * holds must equal the amount the server says is due.
   */
  async capture({ amount, providerPaymentId, providerOrderId, signature }): Promise<PaymentResult> {
    const config = razorpayConfig();
    if (!config) return unavailable();
    if (!providerPaymentId) {
      return { ok: false, providerPaymentId: null, capturedAmount: ZERO, error: "No Razorpay payment id was given.", code: "UNVERIFIED" };
    }

    if (signature !== undefined) {
      if (!providerOrderId) {
        return { ok: false, providerPaymentId, capturedAmount: ZERO, error: "No Razorpay order id to verify against.", code: "UNVERIFIED" };
      }
      if (!verifyPaymentSignature({ providerOrderId, providerPaymentId, signature, keySecret: config.keySecret })) {
        return { ok: false, providerPaymentId, capturedAmount: ZERO, error: "The payment signature did not verify.", code: "UNVERIFIED" };
      }
    }

    // Ask Razorpay what it holds. A verified signature says the browser did
    // not lie; this says the money is actually there, for the right order,
    // in the right amount.
    const fetched = await fetchRazorpayPayment(config, providerPaymentId);
    if (!fetched.ok) return { ok: false, providerPaymentId, capturedAmount: ZERO, error: fetched.error, code: fetchFailureCode(fetched.status) };
    const payment = fetched.payment;

    /*
     * From here on, every refusal is a statement Razorpay's API made about a
     * real payment — marked `gatewayVerified` so the service layer can tell
     * these apart from refusals manufactured before the fetch (a forged
     * signature, a missing reference), which anyone holding an order UUID
     * can produce and which must never be written anywhere (pay-58b, R2).
     */
    if (providerOrderId && payment.order_id !== providerOrderId) {
      return { ok: false, providerPaymentId, capturedAmount: ZERO, error: "That payment belongs to a different order.", code: "GATEWAY_DECLINED", payload: { gatewayVerified: true } };
    }
    if (payment.status !== "captured") {
      return {
        ok: false,
        providerPaymentId,
        capturedAmount: ZERO,
        error: payment.status === "failed" ? (payment.error_description ?? "The payment failed.") : `The payment is ${payment.status}, not captured.`,
        // Failed is an answer. Authorized or created is not yet one: Razorpay
        // auto-captures, so the same payment asked again later is captured.
        code: payment.status === "failed" ? "GATEWAY_DECLINED" : "GATEWAY_UNAVAILABLE",
        payload: { gatewayVerified: true },
      };
    }
    if (payment.currency !== "INR" || BigInt(payment.amount) !== amount) {
      return { ok: false, providerPaymentId, capturedAmount: ZERO, error: "The amount Razorpay captured does not match the order.", code: "GATEWAY_DECLINED", payload: { gatewayVerified: true } };
    }

    return {
      ok: true,
      providerPaymentId,
      capturedAmount: paise(payment.amount),
      payload: {
        method: methodFromRazorpay(payment.method),
        razorpayMethod: payment.method,
        fee: payment.fee ?? 0,
        tax: payment.tax ?? 0,
        orderId: payment.order_id,
        verifiedBy: signature !== undefined ? "signature+api" : "api",
      },
    };
  },

  /**
   * Asks Razorpay to refund, under `X-Refund-Idempotency: <our refund row id>`
   * (razorpay.com/docs/api/refunds/normal-refunds-idempotent): the same key
   * with the same body returns the original refund instead of a second one.
   * The row id is a UUID — 36 characters of hex and hyphens, inside the
   * documented key rules.
   */
  async refund({ providerPaymentId, amount, reason, refundId }): Promise<RefundResult> {
    const config = razorpayConfig();
    // Keys missing or no payment to refund: nothing was sent, so nothing moved.
    if (!config) return { outcome: "refused", providerRefundId: null, refundedAmount: ZERO, httpStatus: null, error: "Online payment is not set up." };
    if (!providerPaymentId) return { outcome: "refused", providerRefundId: null, refundedAmount: ZERO, httpStatus: null, error: "No Razorpay payment to refund." };
    const result = await call<RazorpayRefund>(config, `/payments/${encodeURIComponent(providerPaymentId)}/refund`, {
      method: "POST",
      body: refundRequestBody({ amount, reason, refundId }),
      headers: { "X-Refund-Idempotency": refundId },
    });
    if (!result.ok) return classifyRazorpayRefundFailure(result.error, result.status);
    return classifyRazorpayRefund(result.data, amount, result.status);
  },

  /**
   * Looks for a refund an earlier attempt already asked for, matched by our
   * row id in its notes (ref-2 condition: a resumed refund looks up by
   * frybirdRefundId before it asks again). Not relying on the idempotency
   * key alone: Razorpay documents no validity window for it.
   */
  async findRefund({ providerPaymentId, refundId }): Promise<RefundLookup> {
    const config = razorpayConfig();
    if (!config) return { found: "unknown", error: "Online payment is not set up." };
    if (!providerPaymentId) return { found: false };
    const result = await call<{ items?: RazorpayRefund[] }>(config, `/payments/${encodeURIComponent(providerPaymentId)}/refunds?count=100`);
    if (!result.ok) return { found: "unknown", error: result.error };
    const match = (result.data.items ?? []).find((refund) => noteOf(refund) === refundId);
    if (!match) return { found: false };
    return { found: true, result: { ...classifyRazorpayRefund(match, paise(match.amount), result.status), refundedAmount: match.status === "processed" ? paise(match.amount) : ZERO } };
  },

  /** Verifies a webhook. The event id is Razorpay's `x-razorpay-event-id`, read by the route and passed through the body's own `event` name here. */
  async verifyWebhook({ body, signature }): Promise<WebhookVerification> {
    const config = razorpayConfig();
    if (!config?.webhookSecret) return { ok: false, eventId: null, eventType: null, error: "No webhook secret is configured." };
    if (!signature) return { ok: false, eventId: null, eventType: null, error: "The webhook carried no signature." };
    if (!verifyWebhookSignature({ body, signature, webhookSecret: config.webhookSecret })) {
      return { ok: false, eventId: null, eventType: null, error: "The webhook signature did not verify." };
    }
    let parsed: { event?: string } = {};
    try {
      parsed = JSON.parse(body) as { event?: string };
    } catch {
      return { ok: false, eventId: null, eventType: null, error: "The webhook body was not JSON." };
    }
    return { ok: true, eventId: null, eventType: parsed.event ?? null };
  },
};
