/**
 * Cash.
 *
 * FRYBIRD takes orders on the website and is paid at the counter on
 * collection. There is no gateway, so this provider does not move money — it
 * records that a person did.
 *
 * Written as a full `PaymentProvider` rather than a shortcut through the order
 * service. When Razorpay arrives it implements the same interface and nothing
 * in the order flow changes.
 */

import { type Paise, ZERO, formatINR, subtract } from "@/lib/money";
import {
  type PaymentIntent,
  type PaymentProvider,
  type PaymentResult,
  type RefundResult,
  UnsupportedByProvider,
  type WebhookVerification,
} from "./provider";

export const CASH_PROVIDER = "cash";

export const cashProvider: PaymentProvider = {
  name: CASH_PROVIDER,
  supportedMethods: ["CASH"],

  async createIntent({ orderId, amount }): Promise<PaymentIntent> {
    return {
      orderId,
      amount,
      method: "CASH",
      // Cash has no provider-side order to point at. Fabricating a reference
      // here would make a settlement report look reconcilable when it is not.
      providerOrderId: null,
      requiresCustomerAction: false,
    };
  },

  /**
   * Records cash taken at the counter.
   *
   * `actorUserId` is required. Cash is the one payment method with no external
   * trail — no gateway record, no bank entry until the till is banked — so the
   * only accountability is knowing who took it. §52 logs the change; this
   * refuses to make one anonymously.
   */
  async capture({ amount, actorUserId, tendered }): Promise<PaymentResult> {
    if (!actorUserId) {
      return {
        ok: false,
        providerPaymentId: null,
        capturedAmount: ZERO,
        error: "Cash has to be recorded against a member of staff.",
      };
    }

    if (amount <= ZERO) {
      return {
        ok: false,
        providerPaymentId: null,
        capturedAmount: ZERO,
        error: `Cannot take ${formatINR(amount)}.`,
      };
    }

    // The till can only take what covers the bill. A short tender is refused
    // here, before anything is recorded, rather than booked as a full payment.
    if (tendered !== undefined && tendered < amount) {
      return {
        ok: false,
        providerPaymentId: null,
        capturedAmount: ZERO,
        error: `Cash received (${formatINR(tendered)}) is less than ${formatINR(amount)}.`,
      };
    }

    return {
      ok: true,
      providerPaymentId: null,
      capturedAmount: amount,
      payload: {
        takenBy: actorUserId,
        takenAt: new Date().toISOString(),
        // Recorded with the payment so a receipt or a till count can show what
        // was handed over and what went back, from the row, not from memory.
        ...(tendered !== undefined ? { tendered: tendered.toString(), change: subtract(tendered, amount).toString() } : {}),
      },
    };
  },

  async refund({ amount }): Promise<RefundResult> {
    // Cash out of the till, recorded the same way it went in.
    return { ok: true, providerRefundId: null, refundedAmount: amount as Paise };
  },

  async verifyWebhook(): Promise<WebhookVerification> {
    // Nothing calls back about cash. Returning "unverified" rather than
    // throwing would let a caller treat a forged callback as merely unsigned.
    throw new UnsupportedByProvider(CASH_PROVIDER, "webhooks");
  },
};
