"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { type PlaceOrderResult, placeOrder } from "@/lib/repositories/orders";
import { writeCart } from "./index";

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
    notes: String(formData.get("notes") ?? "") || undefined,
  });

  if (!result.ok) {
    return { status: "error", message: result.error, fieldErrors: result.fieldErrors };
  }

  await writeCart({ lines: [] });
  revalidatePath("/", "layout");
  redirect(`/order/${result.orderId}`);
}
