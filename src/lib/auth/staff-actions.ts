"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { advanceOrder, completeDelivery, rejectOrder } from "@/lib/repositories/orders";
import { recordCashPayment } from "@/lib/repositories/payments";
import { ORDER_STATUSES } from "@/domain/order-status";
import { REJECTION_REASONS } from "@/domain/rejection";

export interface StaffActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Turns an auth failure into a message rather than a stack trace.
 *
 * §57: an honest message. A cashier who lacks a permission should be told
 * that, not shown a crash that looks like the system is broken.
 */
function explain(error: unknown): StaffActionResult {
  if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to do that." };
  throw error;
}

/**
 * Records cash taken at the counter.
 *
 * Re-checks the permission here rather than trusting that the caller reached a
 * screen that showed the button — a form can be submitted without ever loading
 * the page it belongs to. §41.
 */
export async function markPaidAction(input: unknown): Promise<StaffActionResult> {
  const parsed = z.object({ orderId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That order could not be settled." };

  try {
    const staff = await requirePermission("orders.update");
    const result = await recordCashPayment({
      orderId: parsed.data.orderId,
      actorUserId: staff.userId,
      actorRoles: staff.roles,
    });
    revalidatePath("/app/orders");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}

const advanceSchema = z.object({
  orderId: z.uuid(),
  to: z.enum(ORDER_STATUSES),
});

export async function advanceOrderAction(input: unknown): Promise<StaffActionResult> {
  const parsed = advanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That change could not be applied." };

  try {
    // Moving a ticket through the kitchen is kitchen work; cancelling is not.
    const permission = parsed.data.to === "CANCELLED" ? "orders.cancel" : "kitchen.update";
    const staff = await requirePermission(permission);
    const result = await advanceOrder({
      orderId: parsed.data.orderId,
      to: parsed.data.to,
      actorUserId: staff.userId,
      orgId: staff.orgId,
    });
    revalidatePath("/app/orders");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}

const deliverySchema = z.object({
  orderId: z.uuid(),
  cashCollected: z.boolean(),
});

/**
 * Closes a delivery from a rider's phone.
 *
 * `delivery.complete` rather than `orders.update` — the narrowest permission
 * that lets a rider finish the job they are doing, and one that cannot move
 * any other ticket in the shop.
 */
export async function completeDeliveryAction(input: unknown): Promise<StaffActionResult> {
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That delivery could not be closed." };

  try {
    const staff = await requirePermission("delivery.complete");
    const result = await completeDelivery({
      orderId: parsed.data.orderId,
      actorUserId: staff.userId,
      actorRoles: staff.roles,
      orgId: staff.orgId,
      cashCollected: parsed.data.cashCollected,
    });
    revalidatePath("/app/deliveries");
    revalidatePath("/app/orders");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}

const rejectSchema = z.object({
  orderId: z.uuid(),
  reason: z.enum(REJECTION_REASONS),
  note: z.string().trim().max(200).optional(),
});

/** Turns an order down. Needs `orders.cancel`, which a cashier does not hold. */
export async function rejectOrderAction(input: unknown): Promise<StaffActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a reason before turning this down." };

  try {
    const staff = await requirePermission("orders.cancel");
    const result = await rejectOrder({
      orderId: parsed.data.orderId,
      reason: parsed.data.reason,
      note: parsed.data.note,
      actorUserId: staff.userId,
      orgId: staff.orgId,
    });
    revalidatePath("/app/orders");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}
