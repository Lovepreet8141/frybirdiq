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
import { getCustomer } from "@/lib/customer";
import { markOnlinePaymentFailed, recordOnlinePayment } from "@/lib/repositories/payments";

export type OnlinePaymentResult = { ok: true; replayed: boolean } | { ok: false; error: string };

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
  return result.ok ? { ok: true, replayed: result.replayed } : { ok: false, error: result.error };
}

const failureSchema = z.object({
  orderId: z.uuid(),
  reason: z.string().trim().max(250).default("Payment failed"),
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

  const [customer, contact] = await Promise.all([getCustomer(), readRememberedContact()]);
  const { ok } = await markOnlinePaymentFailed({
    orderId: parsed.data.orderId,
    reason: parsed.data.reason || "Payment failed",
    via: { kind: "customer", customerId: customer?.id ?? null, phone: contact?.phone ?? customer?.phone ?? null },
  });

  if (ok) revalidatePath(`/order/${parsed.data.orderId}`);
  return { ok };
}
