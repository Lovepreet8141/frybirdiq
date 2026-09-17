/**
 * Cash at the door, against a real database (card ord-4).
 *
 * The bug: a RIDER holds only `delivery.view` + `delivery.complete`, but
 * `completeDelivery` handed the rider's roles to `recordCashPayment`, which
 * demanded `orders.update` — so no rider could close any unpaid delivery.
 * The fix is a narrow, explicit delivery-cash authorization
 * (`via: "delivery"`): `delivery.complete` may take the cash only for a
 * DELIVERY order that is OUT_FOR_DELIVERY, checked on the order as read
 * under the org scope and again under settle's lock. Every other caller
 * still needs `orders.update`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, idempotencyKeys, orderEvents, orders, payments } from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import { fromRupees } from "@/lib/money";
import { completeDelivery } from "./orders";
import { recordCashPayment } from "./payments";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

type Shape = { readonly channel: "ONLINE" | "TAKEAWAY" | "DINE_IN"; readonly fulfilment: "DELIVERY" | "TAKEAWAY" | "DINE_IN" };
const DELIVERY: Shape = { channel: "ONLINE", fulfilment: "DELIVERY" };
const TAKEAWAY: Shape = { channel: "TAKEAWAY", fulfilment: "TAKEAWAY" };
const DINE_IN: Shape = { channel: "DINE_IN", fulfilment: "DINE_IN" };

async function createOrder(org: TestOrg, shape: Shape, status: OrderStatus) {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status,
      channel: shape.channel,
      fulfilment: shape.fulfilment,
      grandTotal: fromRupees("340"),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

async function paymentsFor(orderId: string) {
  return db().select().from(payments).where(eq(payments.orderId, orderId));
}

async function statusOf(orderId: string) {
  const [row] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  return row?.status;
}

async function idempotencyRowsFor(orderId: string) {
  return db().select().from(idempotencyKeys).where(eq(idempotencyKeys.key, `cash-payment:${orderId}`));
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Starts `call` while a separate transaction holds `SELECT ... FOR UPDATE` on
 * the order row. Once `call` is waiting on that holder's lock — found with
 * pg_blocking_pids on the holder's own pid, so nothing else running against
 * the database can satisfy the wait — `whileHeld` writes inside the holding
 * transaction and it commits. Resolves with `call`'s result.
 */
async function withOrderRowHeld<T>(orderId: string, call: () => Promise<T>, whileHeld: (tx: Tx) => Promise<void>): Promise<T> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: (pid: number) => void;
  const lockTaken = new Promise<number>((resolve) => (locked = resolve));

  const holder = db().transaction(async (tx) => {
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for("update");
    const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    if (!row) throw new Error("test: holder has no backend pid");
    locked(row.pid);
    await released;
    await whileHeld(tx);
  });
  const holderPid = await lockTaken;

  const pending = call();
  try {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const [row] = await db().execute<{ waiting: number }>(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))`,
      );
      if ((row?.waiting ?? 0) >= 1) break;
      if (Date.now() > deadline) throw new Error("test: the call never reached the order-row lock");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    release();
    await holder;
  }
  return pending;
}

describe("cash at the door — a rider closes an unpaid delivery", () => {
  let orgA: TestOrg;
  let orgB: TestOrg;

  beforeAll(async () => {
    orgA = await createTestOrg();
    orgB = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(orgA.orgId);
    await deleteTestOrg(orgB.orgId);
  });

  it("RIDER completes an unpaid DELIVERY order OUT_FOR_DELIVERY with cash: CAPTURED cash payment, rider as actor, order COMPLETED", async () => {
    const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
    const rider = randomUUID();

    const result = await completeDelivery({ orderId, actorUserId: rider, actorRoles: ["RIDER"], orgId: orgA.orgId, cashCollected: true });
    expect(result).toEqual({ ok: true });

    const rows = await paymentsFor(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("CAPTURED");
    expect(rows[0]?.method).toBe("CASH");
    // Server-computed: exactly the order's own total, nothing passed in.
    expect(rows[0]?.amount).toBe(fromRupees("340"));

    expect(await statusOf(orderId)).toBe("COMPLETED");

    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((event) => event.actorUserId === rider)).toBe(true);
    expect(events.some((event) => event.toStatus === "COMPLETED")).toBe(true);

    const [audit] = await db()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, orderId), eq(auditLogs.action, "payment_captured")));
    expect(audit?.actorUserId).toBe(rider);
    expect(audit?.orgId).toBe(orgA.orgId);
  });

  it("RIDER cannot use the delivery path for a non-delivery order", async () => {
    const takeaway = await createOrder(orgA, TAKEAWAY, "PENDING_PAYMENT");
    const dineIn = await createOrder(orgA, DINE_IN, "READY");

    for (const orderId of [takeaway, dineIn]) {
      const direct = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, via: "delivery" });
      expect(direct.ok).toBe(false);
      const closed = await completeDelivery({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, cashCollected: true });
      expect(closed.ok).toBe(false);
      expect(await paymentsFor(orderId)).toHaveLength(0);
    }
    expect(await statusOf(takeaway)).toBe("PENDING_PAYMENT");
    expect(await statusOf(dineIn)).toBe("READY");
  });

  it("RIDER cannot use the delivery path for a delivery that is not OUT_FOR_DELIVERY", async () => {
    for (const status of ["PENDING_PAYMENT", "READY"] as const) {
      const orderId = await createOrder(orgA, DELIVERY, status);
      const direct = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, via: "delivery" });
      expect(direct.ok).toBe(false);
      const closed = await completeDelivery({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, cashCollected: true });
      expect(closed.ok).toBe(false);
      expect(await paymentsFor(orderId)).toHaveLength(0);
      expect(await statusOf(orderId)).toBe(status);
    }
  });

  it("RIDER taking payment without the delivery flag (the markPaid-style path) is still refused", async () => {
    const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
    const result = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId });
    expect(result).toEqual({ ok: false, error: "You don't have permission to take payment." });
    expect(await paymentsFor(orderId)).toHaveLength(0);
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
  });

  it("RIDER marking an unpaid delivery delivered without cash still cannot close it", async () => {
    const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
    const result = await completeDelivery({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, cashCollected: false });
    expect(result.ok).toBe(false);
    expect(await paymentsFor(orderId)).toHaveLength(0);
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
  });

  it("CASHIER path is unchanged: orders.update takes cash on a counter order without any flag", async () => {
    const orderId = await createOrder(orgA, DINE_IN, "PENDING_PAYMENT");
    const cashier = randomUUID();
    const result = await recordCashPayment({ orderId, actorUserId: cashier, actorRoles: ["CASHIER"], orgId: orgA.orgId, tendered: fromRupees("500") });
    expect(result.ok).toBe(true);

    const rows = await paymentsFor(orderId);
    expect(rows.map((row) => row.status)).toEqual(["CAPTURED"]);
    expect(await statusOf(orderId)).toBe("PAID");

    // And a cashier closing a delivery at the door works as before.
    const deliveryId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
    const closed = await completeDelivery({ orderId: deliveryId, actorUserId: cashier, actorRoles: ["CASHIER"], orgId: orgA.orgId, cashCollected: true });
    expect(closed).toEqual({ ok: true });
    expect((await paymentsFor(deliveryId)).map((row) => row.status)).toEqual(["CAPTURED"]);
    expect(await statusOf(deliveryId)).toBe("COMPLETED");
  });

  it.each(["FAILED", "READY"] as const)(
    "under-lock re-check: the delivery moves to %s while the rider's cash waits on the order lock → refused, nothing stored, retry refused the same",
    async (movedTo) => {
      // FAILED is what really happens on the road. READY is a status settle's
      // own gate would let through, so only the delivery guard re-checked
      // under the lock can refuse it.
      const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
      const rider = randomUUID();
      const take = () => recordCashPayment({ orderId, actorUserId: rider, actorRoles: ["RIDER"], orgId: orgA.orgId, via: "delivery" });
      const refusal = { ok: false, error: "Only a delivery that is out for delivery can take cash at the door." };

      const raced = await withOrderRowHeld(orderId, take, async (tx) => {
        await tx.update(orders).set({ status: movedTo }).where(eq(orders.id, orderId));
      });

      expect(raced).toEqual(refusal);
      expect(await paymentsFor(orderId)).toHaveLength(0);
      expect(await idempotencyRowsFor(orderId)).toHaveLength(0);
      expect(await statusOf(orderId)).toBe(movedTo);

      expect(await take()).toEqual(refusal);
      expect(await paymentsFor(orderId)).toHaveLength(0);
      expect(await idempotencyRowsFor(orderId)).toHaveLength(0);
    },
  );

  it("RIDER closes a delivery whose cash the shop already recorded: closes, still one payment", async () => {
    const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
    const recorded = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["CASHIER"], orgId: orgA.orgId });
    expect(recorded.ok).toBe(true);
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");

    const closed = await completeDelivery({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, cashCollected: true });
    expect(closed).toEqual({ ok: true });
    expect((await paymentsFor(orderId)).map((row) => row.status)).toEqual(["CAPTURED"]);
    expect(await statusOf(orderId)).toBe("COMPLETED");
  });

  it("RIDER closes a delivery already paid online: the already-paid refusal still closes it, no cash row added", async () => {
    const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
    await db().insert(payments).values({
      orgId: orgA.orgId,
      orderId,
      status: "CAPTURED",
      method: "UPI",
      amount: fromRupees("340"),
      provider: "razorpay",
      providerPaymentId: `pay_test_${randomUUID().slice(0, 8)}`,
      capturedAt: new Date(),
    });

    const closed = await completeDelivery({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, cashCollected: true });
    expect(closed).toEqual({ ok: true });
    const rows = await paymentsFor(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("razorpay");
    expect(await statusOf(orderId)).toBe("COMPLETED");
  });

  it("KITCHEN with the delivery flag is refused: the flag needs delivery.complete", async () => {
    const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
    const result = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["KITCHEN"], orgId: orgA.orgId, via: "delivery" });
    expect(result).toEqual({ ok: false, error: "You don't have permission to take payment." });
    expect(await paymentsFor(orderId)).toHaveLength(0);
    expect(await idempotencyRowsFor(orderId)).toHaveLength(0);
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
  });

  it("two devices close the same delivery at once: the one whose cash loses the race still gets ok, one payment", async () => {
    const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");

    // The other device's close lands while this rider's cash waits on the lock.
    const closed = await withOrderRowHeld(
      orderId,
      () => completeDelivery({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, cashCollected: true }),
      async (tx) => {
        await tx.insert(payments).values({
          orgId: orgA.orgId,
          orderId,
          status: "CAPTURED",
          method: "CASH",
          amount: fromRupees("340"),
          provider: "cash",
          capturedAt: new Date(),
        });
        await tx.update(orders).set({ status: "COMPLETED" }).where(eq(orders.id, orderId));
      },
    );

    expect(closed).toEqual({ ok: true });
    expect(await paymentsFor(orderId)).toHaveLength(1);
    expect(await statusOf(orderId)).toBe("COMPLETED");

    // A genuine refusal on an order that did not close is still an error.
    const failed = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");
    const refused = await withOrderRowHeld(
      failed,
      () => completeDelivery({ orderId: failed, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgA.orgId, cashCollected: true }),
      async (tx) => {
        await tx.update(orders).set({ status: "FAILED" }).where(eq(orders.id, failed));
      },
    );
    expect(refused.ok).toBe(false);
    expect(await paymentsFor(failed)).toHaveLength(0);
  });

  it("org isolation: a rider of org B cannot take cash for or close org A's delivery", async () => {
    const orderId = await createOrder(orgA, DELIVERY, "OUT_FOR_DELIVERY");

    const direct = await recordCashPayment({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgB.orgId, via: "delivery" });
    expect(direct).toEqual({ ok: false, error: "That order does not exist." });

    const closed = await completeDelivery({ orderId, actorUserId: randomUUID(), actorRoles: ["RIDER"], orgId: orgB.orgId, cashCollected: true });
    expect(closed.ok).toBe(false);

    expect(await paymentsFor(orderId)).toHaveLength(0);
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
  });
});
