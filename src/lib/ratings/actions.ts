"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { orderRatings, orders } from "@/db/schema";

export type RatingState = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

const schema = z.object({
  orderId: z.uuid(),
  score: z.coerce.number().int().min(1).max(5),
});

/**
 * Records a score out of five for an order.
 *
 * The order id is the only credential, which is the same thing that lets
 * someone see the order at all — an unguessable uuid, held either by the person
 * who ordered or by whoever they sent the link to. That is the right bar for a
 * star rating. It is not the bar for anything that moves money.
 *
 * Only a finished order can be rated. Scoring food that has not arrived is
 * meaningless, and allowing it would let a bad minute during the wait become a
 * permanent one star.
 *
 * Re-rating overwrites. Someone tapping three and meaning four should not have
 * to find a phone number, and the unique index makes the alternative a
 * constraint violation anyway.
 */
export async function rateOrder(_previous: RatingState, formData: FormData): Promise<RatingState> {
  const parsed = schema.safeParse({
    orderId: String(formData.get("orderId") ?? ""),
    score: String(formData.get("score") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: "That rating could not be read." };
  }

  const [order] = await db()
    .select({ id: orders.id, orgId: orders.orgId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, parsed.data.orderId))
    .limit(1);

  if (!order) {
    return { status: "error", message: "That order no longer exists." };
  }
  if (order.status !== "COMPLETED") {
    return { status: "error", message: "You can rate this once the order is finished." };
  }

  await db()
    .insert(orderRatings)
    .values({ orgId: order.orgId, orderId: order.id, score: parsed.data.score })
    .onConflictDoUpdate({
      target: orderRatings.orderId,
      set: { score: parsed.data.score, updatedAt: new Date() },
    });

  revalidatePath(`/order/${order.id}`);
  return { status: "saved" };
}
