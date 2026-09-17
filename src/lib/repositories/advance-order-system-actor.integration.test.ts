/**
 * advanceOrder moved by the system, with no staff member (card ord-10).
 *
 * The refund healer finishes a refund whose staff actor is unknown, so
 * `actorUserId` is null. Each branch that writes the actor must store null
 * ("System") rather than fail: the order_events row on every move, the SALE
 * movement and audit row on ACCEPTED, and the RETURN movement on CANCELLED.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, inventoryMovements, orderEvents, orderItems, orders } from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import { fromRupees } from "@/lib/money";
import { advanceOrder } from "./orders";
import { createTestIngredient, createTestOrg, createTestProduct, createTestRecipe, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

describe("advanceOrder with a null (system) actor", () => {
  let org: TestOrg;
  let productId: string;

  beforeAll(async () => {
    org = await createTestOrg();
    const product = await createTestProduct(org.orgId);
    productId = product.id;
    const ingredient = await createTestIngredient(org.orgId, 40n);
    await createTestRecipe(org.orgId, productId, ingredient.id, 150);
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  async function createOrder(status: OrderStatus) {
    const [order] = await db()
      .insert(orders)
      .values({
        orgId: org.orgId,
        locationId: org.locationId,
        orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
        businessDate: new Date().toISOString().slice(0, 10),
        status,
        channel: "TAKEAWAY",
        fulfilment: "TAKEAWAY",
        grandTotal: fromRupees("199"),
      })
      .returning({ id: orders.id });
    if (!order) throw new Error("fixture: order insert returned no row");
    await db().insert(orderItems).values({
      orgId: org.orgId,
      orderId: order.id,
      productId,
      productName: "Test burger",
      quantity: 1,
      unitPrice: fromRupees("199"),
      lineSubtotal: fromRupees("199"),
      lineTotal: fromRupees("199"),
    });
    return order.id;
  }

  const eventsFor = (orderId: string) =>
    db().select({ to: orderEvents.toStatus, actor: orderEvents.actorUserId }).from(orderEvents).where(eq(orderEvents.orderId, orderId));
  const movementsFor = (orderId: string) =>
    db().select({ type: inventoryMovements.type, actor: inventoryMovements.actorUserId }).from(inventoryMovements).where(eq(inventoryMovements.orderId, orderId));

  it("ACCEPTED: records the event and the SALE movement with a null actor", async () => {
    const orderId = await createOrder("PAID");
    expect(await advanceOrder({ orderId, to: "ACCEPTED", actorUserId: null, orgId: org.orgId })).toEqual({ ok: true });

    expect(await eventsFor(orderId)).toEqual([{ to: "ACCEPTED", actor: null }]);
    expect(await movementsFor(orderId)).toEqual([{ type: "SALE", actor: null }]);
    const [audit] = await db()
      .select({ actor: auditLogs.actorUserId })
      .from(auditLogs)
      .where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "stock_consumed"), sql`${auditLogs.after}->>'orderId' = ${orderId}`));
    expect(audit).toEqual({ actor: null });
  });

  it("CANCELLED: credits the stock back with a null actor", async () => {
    const orderId = await createOrder("PAID");
    expect((await advanceOrder({ orderId, to: "ACCEPTED", actorUserId: null, orgId: org.orgId })).ok).toBe(true);
    expect(await advanceOrder({ orderId, to: "CANCELLED", actorUserId: null, orgId: org.orgId, cancellationReason: "test" })).toEqual({ ok: true });

    expect((await eventsFor(orderId)).map((e) => e.actor)).toEqual([null, null]);
    const movements = await movementsFor(orderId);
    expect(movements.map((m) => m.type).sort()).toEqual(["RETURN", "SALE"]);
    expect(movements.every((m) => m.actor === null)).toBe(true);
  });

  it("REFUNDED: records the event with a null actor and writes no stock movement", async () => {
    const orderId = await createOrder("COMPLETED");
    expect(await advanceOrder({ orderId, to: "REFUNDED", actorUserId: null, orgId: org.orgId, reason: "Refunded — test" })).toEqual({ ok: true });

    expect(await eventsFor(orderId)).toEqual([{ to: "REFUNDED", actor: null }]);
    expect(await movementsFor(orderId)).toEqual([]);
    const [order] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe("REFUNDED");
  });
});
