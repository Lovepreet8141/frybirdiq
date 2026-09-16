"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { type PlaceOrderResult, placeOrder } from "@/lib/repositories/orders";
import { writeCart } from "./index";
import { rememberAddress } from "./remembered-address";
import { rememberContact } from "./remembered-contact";

export type CheckoutState = { status: "idle" } | { status: "error"; message: string; fieldErrors?: Record<string, string> };

/**
 * Places the order, then clears the cart and redirects.
 *
 * The cart is cleared only after the order is safely written. Clearing first
 * would lose the customer's whole order if the write failed — §57: never make
 * failure look like success, and never make it cost anything either.
 */
export async function submitCheckout(_previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const result: PlaceOrderResult = await placeOrder({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
    marketingConsent: formData.get("marketingConsent") === "on",
    notes: String(formData.get("notes") ?? "") || undefined,
    fulfilment: String(formData.get("fulfilment") ?? "TAKEAWAY"),
    // Left as strings; the schema coerces them. Empty means no pin.
    lat: String(formData.get("lat") ?? "") || undefined,
    lng: String(formData.get("lng") ?? "") || undefined,
    addressLine1: String(formData.get("addressLine1") ?? "") || undefined,
    landmark: String(formData.get("landmark") ?? "") || undefined,
    // Minted when the page rendered. A double-tap sends the same key twice and
    // the second returns the first order rather than creating another. §17.
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    // "ASAP" or "SCHEDULED"; scheduledFor is only read when the latter, and
    // re-validated on the server regardless of what the client sent.
    when: String(formData.get("when") ?? "ASAP"),
    scheduledFor: String(formData.get("scheduledFor") ?? "") || undefined,
    // "COD" or "ONLINE". The server checks it against what is actually offered.
    payment: String(formData.get("payment") ?? "COD"),
  });

  if (!result.ok) {
    // A recent unpaid order already exists for this phone — sent back to
    // finish paying it rather than shown a dead-end error. The current
    // cart is deliberately left untouched here (unlike the success path
    // below): nothing new was placed, so there is nothing to clear.
    if (result.resumeOrderId) redirect(`/order/${result.resumeOrderId}?pay=1`);
    return { status: "error", message: result.error, fieldErrors: result.fieldErrors };
  }

  // Remembered only once the order actually went through, so a failed attempt
  // does not leave a device claiming details nobody ordered with.
  await rememberContact({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
  });

  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) {
    await rememberAddress({
      line1: String(formData.get("addressLine1") ?? ""),
      landmark: String(formData.get("landmark") ?? "") || null,
      lat,
      lng,
    });
  }

  await writeCart({ lines: [] });
  revalidatePath("/", "layout");
  // An online order lands on its page with the payment window opening at
  // once; closing it leaves the order waiting there with a Pay now button.
  redirect(result.payment === "ONLINE" ? `/order/${result.orderId}?pay=1` : `/order/${result.orderId}`);
}
