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

export interface PaymentResult {
  readonly ok: boolean;
  readonly providerPaymentId: string | null;
  readonly capturedAmount: Paise;
  readonly error?: string;
  readonly payload?: Record<string, unknown>;
}

export interface RefundResult {
  readonly ok: boolean;
  readonly providerRefundId: string | null;
  readonly refundedAmount: Paise;
  readonly error?: string;
}

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
    providerPaymentId?: string;
    signature?: string;
  }): Promise<PaymentResult>;

  refund(input: { providerPaymentId: string | null; amount: Paise; reason: string }): Promise<RefundResult>;

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
