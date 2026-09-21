"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { type CompleteDeliveryCode, acceptOrder, advanceOrder, completeDelivery, rejectOrder } from "@/lib/repositories/orders";
import { readyGateRefusal } from "@/lib/repositories/kitchen-stations";
import { recordCashPayment } from "@/lib/repositories/payments";
import { recordRiderPosition } from "@/lib/repositories/rider-tracking";
import { FAIL_REASON_MAX, FAIL_REASON_MIN, assignRider, failDelivery, releaseDelivery, takeDelivery } from "@/lib/repositories/rider-assignment";
import { staffMayAdvanceTo } from "@/lib/orders/staff-advance";
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
      orgId: staff.orgId,
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

  // Only the kitchen moves the board makes, refused before any permission
  // check or read. PAID is set only by a recorded payment and REFUNDED only by
  // `refundPayment`; without this, a cashier or kitchen user holding
  // `kitchen.update` could mark a paid or completed order refunded with no
  // money moving, reversing its loyalty. CANCELLED goes only through
  // `rejectOrderAction`, which carries a reason.
  if (!staffMayAdvanceTo(parsed.data.to)) {
    return { ok: false, error: "That change could not be applied." };
  }

  try {
    const staff = await requirePermission("kitchen.update");
    if (parsed.data.to === "READY") {
      const refusal = await readyGateRefusal(staff.orgId, parsed.data.orderId);
      if (refusal) return { ok: false, error: refusal };
    }
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
 * `completeDeliveryAction`'s result. Branch on `code`; `error` is for display.
 *
 * - `INVALID_INPUT`: the request did not parse.
 * - `SIGNED_OUT` / `NOT_PERMITTED`: the auth refusals `explain` covers.
 * - `SERVER_ERROR`: something unexpected threw on the server. The action
 *   resolves with this instead of rejecting, so a client that sees the
 *   promise reject knows the request never completed (offline, stale tab).
 * - everything else: `completeDelivery`'s own refusals (`CompleteDeliveryCode`).
 */
export type CompleteDeliveryActionCode = CompleteDeliveryCode | "INVALID_INPUT" | "SIGNED_OUT" | "NOT_PERMITTED" | "SERVER_ERROR";

export type CompleteDeliveryActionResult = { ok: true } | { ok: false; code: CompleteDeliveryActionCode; error: string };

/**
 * Closes a delivery from a rider's phone.
 *
 * `delivery.complete` rather than `orders.update` — the narrowest permission
 * that lets a rider finish the job they are doing, and one that cannot move
 * any other ticket in the shop. The cash taken at the door is booked under
 * this same permission, but only for a delivery that is out for delivery —
 * `completeDelivery` passes that authorization explicitly (card ord-4).
 */
export async function completeDeliveryAction(input: unknown): Promise<CompleteDeliveryActionResult> {
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", error: "That delivery could not be closed." };

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
    return result.ok ? { ok: true } : { ok: false, code: result.code, error: result.error };
  } catch (error) {
    // Let Next's own control-flow throws (redirect, notFound) through.
    unstable_rethrow(error);
    if (error instanceof NotSignedIn) return { ok: false, code: "SIGNED_OUT", error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { ok: false, code: "NOT_PERMITTED", error: "You don't have permission to do that." };
    // The detail stays in the server log; the rider gets a plain message.
    console.error("completeDeliveryAction failed", error);
    return { ok: false, code: "SERVER_ERROR", error: "Something went wrong closing that delivery. Try again." };
  }
}

const assignRiderSchema = z.object({ orderId: z.uuid(), riderUserId: z.uuid() });

/**
 * Assigns a rider to a delivery (roadmap 6.3). `delivery.assign`: OWNER, ADMIN,
 * MANAGER. The repository re-checks that the order is an open delivery of this
 * org and that the person is one of its active riders.
 */
export async function assignRiderAction(input: unknown): Promise<StaffActionResult> {
  const parsed = assignRiderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a rider." };

  try {
    const staff = await requirePermission("delivery.assign");
    const result = await assignRider({ orgId: staff.orgId, orderId: parsed.data.orderId, riderUserId: parsed.data.riderUserId, actorUserId: staff.userId });
    revalidatePath("/app/deliveries");
    revalidatePath("/app/orders");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}

const takeDeliverySchema = z.object({ orderId: z.uuid() });

/**
 * A rider takes an available delivery ("Take it"). `delivery.take`; the rider is the signed-in person, never
 * the form. One conditional UPDATE decides it, so the first tap wins and the rest are told it is taken.
 */
export async function takeDeliveryAction(input: unknown): Promise<StaffActionResult> {
  const parsed = takeDeliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That delivery could not be found." };

  try {
    const staff = await requirePermission("delivery.take");
    const result = await takeDelivery({ orgId: staff.orgId, orderId: parsed.data.orderId, riderUserId: staff.userId });
    revalidatePath("/app/deliveries");
    revalidatePath("/app/orders");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}

/**
 * A rider gives a delivery they hold back to Available (owner decision, 2026-09-21). `delivery.take`; the rider is the
 * signed-in person, never the form; the repository releases only a delivery THIS rider holds. Audited.
 */
export async function releaseDeliveryAction(input: unknown): Promise<StaffActionResult> {
  const parsed = takeDeliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That delivery could not be found." };

  try {
    const staff = await requirePermission("delivery.take");
    const result = await releaseDelivery({ orgId: staff.orgId, orderId: parsed.data.orderId, riderUserId: staff.userId });
    revalidatePath("/app/deliveries");
    revalidatePath("/app/orders");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}

const riderPositionSchema = z.object({ orderId: z.uuid(), lat: z.number(), lng: z.number(), accuracyMetres: z.number().nullish() });

/**
 * A rider's browser reports where it is, about every 15 seconds, while a delivery it holds is out. `delivery.complete`; the rider is
 * the signed-in person, never the form; the repository accepts a fix only for a delivery THIS rider holds that is OUT_FOR_DELIVERY.
 * A fix that arrives too soon after the last one is dropped without an error. Nothing here touches money or the order.
 */
export async function postRiderPositionAction(input: unknown): Promise<StaffActionResult> {
  const parsed = riderPositionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That location could not be read." };

  try {
    const staff = await requirePermission("delivery.complete");
    const result = await recordRiderPosition({
      orgId: staff.orgId,
      orderId: parsed.data.orderId,
      riderUserId: staff.userId,
      position: { lat: parsed.data.lat, lng: parsed.data.lng, accuracyMetres: parsed.data.accuracyMetres },
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}

const failDeliverySchema = z.object({ orderId: z.uuid(), reason: z.string().trim().min(FAIL_REASON_MIN).max(FAIL_REASON_MAX) });

/**
 * Records a delivery that could not be made, with a reason. `delivery.complete`
 * is the permission; the repository limits a rider to their own delivery.
 */
export async function failDeliveryAction(input: unknown): Promise<StaffActionResult> {
  const parsed = failDeliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Say why it could not be delivered (${FAIL_REASON_MIN}-${FAIL_REASON_MAX} characters).` };

  try {
    const staff = await requirePermission("delivery.complete");
    const result = await failDelivery({ orgId: staff.orgId, orderId: parsed.data.orderId, actorUserId: staff.userId, actorRoles: staff.roles, reason: parsed.data.reason });
    revalidatePath("/app/deliveries");
    revalidatePath("/app/orders");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return explain(error);
  }
}

const acceptSchema = z.object({
  orderId: z.uuid(),
  prepMinutes: z.number().int().min(1).max(240),
});

/** Accepts an order and records when the kitchen said it would be ready. */
export async function acceptOrderAction(input: unknown): Promise<StaffActionResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick how long this will take." };

  try {
    const staff = await requirePermission("kitchen.update");
    const result = await acceptOrder({
      orderId: parsed.data.orderId,
      prepMinutes: parsed.data.prepMinutes,
      actorUserId: staff.userId,
      orgId: staff.orgId,
    });
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

/**
 * Turns an order down. Needs `orders.cancel`, which OWNER, MANAGER and CASHIER
 * hold (src/domain/permissions.ts). A paid order is refused inside
 * `advanceOrder`'s locked transaction: that needs a refund, which a cashier
 * cannot make.
 */
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
