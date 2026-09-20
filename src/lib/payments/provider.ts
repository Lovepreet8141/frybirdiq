/**
 * The payment provider interface. BUILD-PLAN.md §3.
 *
 * "Never couple checkout/business logic directly to one provider."
 *
 * Cash is the first implementation, not a special case bolted beside a real
 * one. Razorpay arrives as a second implementation of this interface and the
 * order service does not change — that is the whole point of writing the
 * interface before there is a gateway to hide behind it.
 *
 * Everything here is money-shaped, so every amount is `Paise`.
 */

import type { Paise } from "@/lib/money";

export type PaymentMethod = "UPI" | "CASH" | "CARD" | "NETBANKING" | "WALLET" | "OTHER";

/** What the customer is asked to pay, and against what. */
export interface PaymentIntent {
  readonly orderId: string;
  readonly amount: Paise;
  readonly method: PaymentMethod;
  /** Provider-side id, where the provider has one. Null for cash. */
  readonly providerOrderId: string | null;
  /**
   * Whether the customer has to do something in a browser before the money
   * moves. False for cash: there is nothing to redirect to.
   */
  readonly requiresCustomerAction: boolean;
}

/**
 * Why a capture did not happen, as a closed set a caller can branch on (pay-7):
 * the Razorpay webhook decides "retry" or "final" from this, never from the
 * wording of `error`.
 *
 * - `UNVERIFIED`: refused before the gateway was asked (no reference, a
 *   signature that does not verify). Anyone holding an order UUID can cause it.
 * - `GATEWAY_DECLINED`: the gateway answered and the answer is no — the
 *   payment failed, is for a different order, or is the wrong amount. Final.
 * - `GATEWAY_UNAVAILABLE`: nobody knows yet — the gateway could not be
 *   reached, answered 5xx, or reports the payment not captured yet. Retry.
 */
export type CaptureFailureCode = "UNVERIFIED" | "GATEWAY_DECLINED" | "GATEWAY_UNAVAILABLE";

export interface PaymentResult {
  readonly ok: boolean;
  readonly providerPaymentId: string | null;
  readonly capturedAmount: Paise;
  readonly error?: string;
  /** Set on a failure by a provider that talks to a gateway; see `CaptureFailureCode`. */
  readonly code?: CaptureFailureCode;
  readonly payload?: Record<string, unknown>;
}

/**
 * What a provider says happened to a refund — a closed set, because each one
 * leads the service layer somewhere different (refund design Revision 2, S5):
 *
 * - `succeeded`: the money has gone back. The refund row becomes SUCCEEDED.
 * - `pending`: the provider accepted the refund but has not finished it
 *   (Razorpay's refund status "pending"). The row stays RESERVED; a retry
 *   looks it up again.
 * - `refused`: the provider definitively did not move money (a 4xx with an
 *   error body, a refund it reports as failed). The row becomes FAILED and
 *   its amount is released.
 * - `ambiguous`: nobody knows — a timeout, a network error, a 5xx, a 409, an
 *   amount that does not match. The row stays RESERVED, holding its amount,
 *   and nothing is booked until a retry finds out.
 */
export type RefundOutcome = "succeeded" | "pending" | "refused" | "ambiguous";

export interface RefundResult {
  readonly outcome: RefundOutcome;
  readonly providerRefundId: string | null;
  /** What the provider says it refunded; ZERO when it did not say. */
  readonly refundedAmount: Paise;
  /** The HTTP status behind the outcome, for the audit row; null for cash, a network error or a timeout. */
  readonly httpStatus: number | null;
  readonly error?: string;
}

/** The provider's record of an earlier refund, found without asking it to refund again. */
export type RefundLookup = { readonly found: true; readonly result: RefundResult } | { readonly found: false } | { readonly found: "unknown"; readonly error: string };

export interface WebhookVerification {
  readonly ok: boolean;
  readonly eventId: string | null;
  readonly eventType: string | null;
  readonly error?: string;
}

/**
 * A payment provider.
 *
 * A provider never touches the database and never decides an order's status.
 * It moves money — or, for cash, records that a human did — and returns what
 * happened. The service layer owns the consequences.
 */
export interface PaymentProvider {
  /** Stable key stored on `payments.provider`. */
  readonly name: string;
  readonly supportedMethods: readonly PaymentMethod[];

  /** Prepares a payment. For a gateway this creates the provider-side order. */
  createIntent(input: { orderId: string; amount: Paise; method: PaymentMethod }): Promise<PaymentIntent>;

  /**
   * Confirms the money has actually arrived.
   *
   * For a gateway this verifies a signature. For cash it records that a named
   * member of staff took it, which is why the actor is required.
   */
  capture(input: {
    orderId: string;
    amount: Paise;
    actorUserId: string | null;
    /** Cash handed over at the counter, when it differs from the amount due — the change is recorded with the payment. */
    tendered?: Paise;
    providerPaymentId?: string;
    /** The provider-side order the payment was made against, for signature checks. */
    providerOrderId?: string;
    signature?: string;
  }): Promise<PaymentResult>;

  /**
   * Asks for money back. `refundId` is our refund row's id: a gateway sends it
   * as its idempotency key and records it on the refund, so repeating this
   * call for the same row can never refund twice. Every input must be read
   * from that row, so a repeat sends a byte-identical request.
   */
  refund(input: { providerPaymentId: string | null; amount: Paise; reason: string; refundId: string }): Promise<RefundResult>;

  /**
   * Finds a refund an earlier attempt already asked for, by our refund row
   * id — before a resumed refund asks again. Absent for a provider with
   * nothing external to look up (cash).
   */
  findRefund?(input: { providerPaymentId: string | null; refundId: string }): Promise<RefundLookup>;

  /** Verifies an inbound webhook. §45. */
  verifyWebhook(input: { body: string; signature: string | null }): Promise<WebhookVerification>;
}

/** Thrown when a provider is asked for something it cannot do. */
export class UnsupportedByProvider extends Error {
  constructor(provider: string, operation: string) {
    super(`payments: the ${provider} provider does not support ${operation}`);
    this.name = "UnsupportedByProvider";
  }
}
