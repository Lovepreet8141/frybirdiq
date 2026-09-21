"use server";

/**
 * The customer's side of paying online. Roadmap 1.2 / 1.5.
 *
 * Reached from the order page after Razorpay Checkout closes. No staff
 * session: the customer is anonymous here, and the proof is the signature
 * plus Razorpay's own record, both checked by the provider. Nothing in
 * these inputs can set an amount or a status.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { readRememberedContact } from "@/lib/cart/remembered-contact";
import { rememberedPhoneFor } from "@/components/order/viewer-owns-order";
import { getCustomer } from "@/lib/customer";
import { type RecordPaymentCode, markOnlinePaymentFailed, recordOnlinePayment } from "@/lib/repositories/payments";

/**
 * `code` lets the order page choose what to say without reading `error`
 * (pay-ready): GATEWAY_DECLINED — offer "Try again"; GATEWAY_UNAVAILABLE — "we
 * are checking with the bank, do not pay again"; RECORDED_FOR_REFUND — "this
 * order was already paid, your money will be refunded". Absent when the input
 * itself was malformed.
 */
export type OnlinePaymentResult = { ok: true; replayed: boolean } | { ok: false; error: string; code?: RecordPaymentCode };

/** The single answer for "could not be confirmed" that gives an unauthenticated caller nothing to probe. */
const UNCONFIRMED = { ok: false, error: "That payment could not be confirmed. If money left your account, it will be refunded automatically.", code: "UNVERIFIED" } as const;

/** For a retryable gateway failure: the money may be in flight, so say so and do not offer another payment. */
const CHECKING_WITH_BANK = { ok: false, error: "We're checking with the bank. Please don't pay again. This page will update once your payment is confirmed.", code: "GATEWAY_UNAVAILABLE" } as const;

const confirmSchema = z.object({
  orderId: z.uuid(),
  razorpayOrderId: z.string().trim().min(1).max(64),
  razorpayPaymentId: z.string().trim().min(1).max(64),
  razorpaySignature: z.string().trim().regex(/^[0-9a-fA-F]{64}$/),
});

export async function confirmOnlinePaymentAction(input: unknown): Promise<OnlinePaymentResult> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That payment could not be confirmed. If money left your account, it will be refunded automatically." };

  const result = await recordOnlinePayment({
    orderId: parsed.data.orderId,
    providerPaymentId: parsed.data.razorpayPaymentId,
    providerOrderId: parsed.data.razorpayOrderId,
    signature: parsed.data.razorpaySignature,
  });

  revalidatePath(`/order/${parsed.data.orderId}`);
  revalidatePath("/app/orders");
  if (result.ok) return { ok: true, replayed: result.replayed };
  // No existence oracle: an unauthenticated caller must not be able to tell an unknown (or another shop's) order,
  // an order that opened a different gateway order, and a bad signature apart. One answer for all three.
  if (result.code === "ORDER_NOT_FOUND" || result.code === "NOT_THIS_ORDER" || result.code === "UNVERIFIED") return UNCONFIRMED;
  // The gateway could not be reached or refused OUR credentials: the customer may already have paid. Never show the
  // gateway's own words (they can name our account or keys) and never invite a second payment.
  if (result.code === "GATEWAY_UNAVAILABLE") return CHECKING_WITH_BANK;
  return { ok: false, error: result.error, code: result.code };
}

const failureSchema = z.object({
  orderId: z.uuid(),
  /** Accepted for shape compatibility and deliberately ignored — see below. */
  reason: z.string().trim().max(250).optional(),
});

/**
 * Checkout's `payment.failed` — noted against the pending payment so the page
 * can say so. Never touches the order.
 *
 * Bound to the caller's own order (pay-5): the repository writes only when
 * the signed-in customer, or the phone this device checked out with (the
 * httpOnly contact cookie the checkout sets), matches the order. An anonymous
 * caller holding a bare order UUID changes nothing — the answer is the same
 * `{ ok: false }` an unknown order gets, so nothing about the order's
 * existence leaks either.
 */
export async function reportOnlinePaymentFailureAction(input: unknown): Promise<{ ok: boolean }> {
  const parsed = failureSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  // The client's `reason` is parsed and thrown away (pay-58b, RED R1): the
  // order page shows this text to the real customer, and phone-plus-UUID is
  // not authorship. The repository stores a fixed server-chosen line; the
  // gateway's own words only ever arrive through the verified webhook.
  const [customer, contact] = await Promise.all([getCustomer(), readRememberedContact()]);
  const { ok } = await markOnlinePaymentFailed({
    orderId: parsed.data.orderId,
    via: { kind: "customer", customerId: customer?.id ?? null, phone: rememberedPhoneFor(parsed.data.orderId, contact) ?? customer?.phone ?? null },
  });

  if (ok) revalidatePath(`/order/${parsed.data.orderId}`);
  return { ok };
}
