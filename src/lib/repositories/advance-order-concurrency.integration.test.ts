/**
 * advanceOrder against a real database — the SELECT ... FOR UPDATE fix.
 *
 * The bug: two concurrent, individually-valid transitions on the same order
 * (a kitchen tablet marking READY at the same moment a manager cancels it)
 * both read the same starting status, both passed `assertTransition`
 * against it, and both wrote — an order's final status became whichever
 * write landed last rather than either genuine transition, and the
 * order_events trail showed two different transitions forking from the
 * same fromStatus. Provable only against a real Postgres: the lock makes
 * the loser wait for the winner to commit, then correctly see the new
 * status and correctly refuse.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderEvents, orderItems, orders, wasteEntries } from "@/db/schema";
import { advanceOrder, rejectOrder } from "./orders";
import { createTestIngredient, createTestOrg, createTestProduct, createTestRecipe, createTestTaxRate, deleteTestOrg, warmPool, type TestOrg } from "./__test-support__/fixtures";
import { fromRupees } from "@/lib/money";

async function createTestOrderAt(org: TestOrg, status: "PAID" | "PREPARING") {
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
      grandTotal: fromRupees("200"),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

describe("advanceOrder", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("moves a valid transition and records one event", async () => {
    const orderId = await createTestOrderAt(org, "PAID");
    const result = await advanceOrder({ orderId, to: "ACCEPTED", actorUserId: randomUUID(), orgId: org.orgId });
    expect(result.ok).toBe(true);

    const [order] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe("ACCEPTED");
  });

  it("rejects a transition the state machine does not allow", async () => {
    const orderId = await createTestOrderAt(org, "PAID");
    const result = await advanceOrder({ orderId, to: "READY", actorUserId: randomUUID(), orgId: org.orgId });
    expect(result.ok).toBe(false);
  });

  it("Priority's actual design point: two concurrent, individually-valid transitions on the SAME order never both land", async () => {
    const orderId = await createTestOrderAt(org, "PREPARING");

    await warmPool();

    // From PREPARING, both CANCELLED and REFUNDED are individually valid
    // next steps — exactly the fork this lock exists to prevent. Chosen
    // deliberately as a pair where, whichever one the lock lets land first,
    // the other is guaranteed to fail afterwards: both CANCELLED and
    // REFUNDED are hard-terminal in the state graph (TRANSITIONS[...] === []
    // for each), so there is no ordering of the race where a real,
    // *sequential* second transition could legitimately still succeed —
    // unlike racing against READY, which stays reachable from more states
    // and would make "both succeeded" sometimes correct instead of a bug.
    const [toCancelled, toRefunded] = await Promise.all([
      advanceOrder({ orderId, to: "CANCELLED", actorUserId: randomUUID(), orgId: org.orgId }),
      advanceOrder({ orderId, to: "REFUNDED", actorUserId: randomUUID(), orgId: org.orgId }),
    ]);

    const results = [toCancelled, toRefunded];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1); // exactly one of the two transitions actually happened
    expect(failed).toHaveLength(1);

    const [order] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    expect(["CANCELLED", "REFUNDED"]).toContain(order?.status); // one real, consistent outcome

    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
    expect(events).toHaveLength(1); // not two transitions forking from the same fromStatus
    expect(events[0]?.toStatus).toBe(order?.status); // the event trail agrees with the row that actually landed
  });
});

describe("rejectOrder", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("turns an order down and records the reason on the order and the event", async () => {
    const orderId = await createTestOrderAt(org, "PAID");
    const result = await rejectOrder({ orderId, reason: "SOLD_OUT", actorUserId: randomUUID(), orgId: org.orgId });
    expect(result.ok).toBe(true);

    const [order] = await db().select({ status: orders.status, cancellationReason: orders.cancellationReason }).from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe("CANCELLED");
    expect(order?.cancellationReason).toContain("Sold out");

    const [event] = await db().select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
    expect(event?.toStatus).toBe("CANCELLED");
    expect(event?.reason).toContain("Sold out");
  });

  it("used to bypass advanceOrder's lock entirely — now it shares the same one, closing the race a reviewer found in this priority's own fix", async () => {
    const orderId = await createTestOrderAt(org, "PREPARING");

    await warmPool();

    // REFUNDED (via advanceOrder, e.g. a manager processing a refund) and
    // CANCELLED (via rejectOrder, e.g. kitchen turning it down) racing the
    // same order — both hard-terminal, so exactly one can ever land,
    // whichever the lock lets through first.
    const [toRefunded, rejected] = await Promise.all([
      advanceOrder({ orderId, to: "REFUNDED", actorUserId: randomUUID(), orgId: org.orgId }),
      rejectOrder({ orderId, reason: "OUT_OF_AREA", actorUserId: randomUUID(), orgId: org.orgId }),
    ]);

    const results = [toRefunded, rejected];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const [order] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    expect(["REFUNDED", "CANCELLED"]).toContain(order?.status);

    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
    expect(events).toHaveLength(1); // not one event from each side of the race
    expect(events[0]?.toStatus).toBe(order?.status);
  });

  it("a rejection's specific reason reaches the stock-waste note, not a generic one — regression caught by review while fixing the race above", async () => {
    const taxRate = await createTestTaxRate(org.orgId);
    const product = await createTestProduct(org.orgId, { taxRateId: taxRate.id });
    const ingredient = await createTestIngredient(org.orgId, 40n);
    await createTestRecipe(org.orgId, product.id, ingredient.id, 150);

    const orderId = await createTestOrderAt(org, "PAID");
    await db().insert(orderItems).values({
      orgId: org.orgId,
      orderId,
      productId: product.id,
      productName: "Test Product",
      unitPrice: fromRupees("99"),
      lineSubtotal: fromRupees("99"),
      lineTotal: fromRupees("99"),
    });

    // ACCEPTED triggers real consumption against the recipe above, so the
    // rejection below has an actual SALE movement to turn into waste.
    const accepted = await advanceOrder({ orderId, to: "ACCEPTED", actorUserId: randomUUID(), orgId: org.orgId });
    expect(accepted.ok).toBe(true);
    const prepping = await advanceOrder({ orderId, to: "PREPARING", actorUserId: randomUUID(), orgId: org.orgId });
    expect(prepping.ok).toBe(true);

    const rejected = await rejectOrder({ orderId, reason: "SOLD_OUT", note: "no fries left", actorUserId: randomUUID(), orgId: org.orgId });
    expect(rejected.ok).toBe(true);

    const [waste] = await db()
      .select({ notes: wasteEntries.notes })
      .from(wasteEntries)
      .where(and(eq(wasteEntries.orgId, org.orgId), eq(wasteEntries.orderId, orderId)));
    expect(waste?.notes).toBe("Sold out — no fries left"); // the actual reason, not "Order #X cancelled"
  });
});
