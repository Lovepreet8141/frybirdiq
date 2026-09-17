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
  type PaymentIntent,
  type PaymentMethod,
  type PaymentProvider,
  type PaymentResult,
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

interface RazorpayRefund {
  readonly id: string;
  readonly amount: number;
  readonly status: string;
}

async function call<T>(config: RazorpayConfig, path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init?.method ?? "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, error: `Razorpay could not be reached (${error instanceof Error ? error.message : "network error"}).` };
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
    return { ok: false, error: description ? `Razorpay: ${description}` : `Razorpay returned ${response.status}.` };
  }
  return { ok: true, data: data as T };
}

export async function fetchRazorpayPayment(config: RazorpayConfig, providerPaymentId: string): Promise<{ ok: true; payment: RazorpayPayment } | { ok: false; error: string }> {
  const result = await call<RazorpayPayment>(config, `/payments/${encodeURIComponent(providerPaymentId)}`);
  return result.ok ? { ok: true, payment: result.data } : result;
}

/* ------------------------------------------------------------------ */
/* The provider                                                        */
/* ------------------------------------------------------------------ */

function unavailable(): PaymentResult {
  return { ok: false, providerPaymentId: null, capturedAmount: ZERO, error: "Online payment is not set up." };
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
      return { ok: false, providerPaymentId: null, capturedAmount: ZERO, error: "No Razorpay payment id was given." };
    }

    if (signature !== undefined) {
      if (!providerOrderId) {
        return { ok: false, providerPaymentId, capturedAmount: ZERO, error: "No Razorpay order id to verify against." };
      }
      if (!verifyPaymentSignature({ providerOrderId, providerPaymentId, signature, keySecret: config.keySecret })) {
        return { ok: false, providerPaymentId, capturedAmount: ZERO, error: "The payment signature did not verify." };
      }
    }

    // Ask Razorpay what it holds. A verified signature says the browser did
    // not lie; this says the money is actually there, for the right order,
    // in the right amount.
    const fetched = await fetchRazorpayPayment(config, providerPaymentId);
    if (!fetched.ok) return { ok: false, providerPaymentId, capturedAmount: ZERO, error: fetched.error };
    const payment = fetched.payment;

    /*
     * From here on, every refusal is a statement Razorpay's API made about a
     * real payment — marked `gatewayVerified` so the service layer can tell
     * these apart from refusals manufactured before the fetch (a forged
     * signature, a missing reference), which anyone holding an order UUID
     * can produce and which must never be written anywhere (pay-58b, R2).
     */
    if (providerOrderId && payment.order_id !== providerOrderId) {
      return { ok: false, providerPaymentId, capturedAmount: ZERO, error: "That payment belongs to a different order.", payload: { gatewayVerified: true } };
    }
    if (payment.status !== "captured") {
      return {
        ok: false,
        providerPaymentId,
        capturedAmount: ZERO,
        error: payment.status === "failed" ? (payment.error_description ?? "The payment failed.") : `The payment is ${payment.status}, not captured.`,
        payload: { gatewayVerified: true },
      };
    }
    if (payment.currency !== "INR" || BigInt(payment.amount) !== amount) {
      return { ok: false, providerPaymentId, capturedAmount: ZERO, error: "The amount Razorpay captured does not match the order.", payload: { gatewayVerified: true } };
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

  async refund({ providerPaymentId, amount, reason }): Promise<RefundResult> {
    const config = razorpayConfig();
    if (!config) return { ok: false, providerRefundId: null, refundedAmount: ZERO, error: "Online payment is not set up." };
    if (!providerPaymentId) return { ok: false, providerRefundId: null, refundedAmount: ZERO, error: "No Razorpay payment to refund." };
    const result = await call<RazorpayRefund>(config, `/payments/${encodeURIComponent(providerPaymentId)}/refund`, {
      method: "POST",
      body: { amount: toRazorpayAmount(amount), notes: { reason: reason.slice(0, 250) } },
    });
    if (!result.ok) return { ok: false, providerRefundId: null, refundedAmount: ZERO, error: result.error };
    return { ok: true, providerRefundId: result.data.id, refundedAmount: paise(result.data.amount) };
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
