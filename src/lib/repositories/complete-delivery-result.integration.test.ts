/**
 * `completeDelivery`'s typed refusals against a real database (card ord-8).
 *
 * The delivery card used to tell "closed elsewhere" from a real failure by
 * matching the message text. Each refusal now carries a `code`; these tests
 * pin which code each order state produces, including the lost race where
 * another device completes the order between the first read and the status
 * change.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import { fromRupees } from "@/lib/money";
import { completeDelivery } from "./orders";
import { failDelivery } from "./rider-assignment";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * A rider closes only a delivery assigned to them (roadmap 6.3), so every delivery these tests create is assigned
 * to this one rider, and every rider actor below is this rider. Who may close whose delivery is pinned in
 * rider-assignment.integration.test.ts; these tests are about what closing does.
 */
const TEST_RIDER = "00000000-0000-4000-8000-0000000000a1";

async function createOrder(org: TestOrg, fulfilment: "DELIVERY" | "TAKEAWAY", status: OrderStatus) {
  const [order] = await db()
    .insert(orders)
    .values({
      orgId: org.orgId,
      locationId: org.locationId,
      orderNumber: `TEST-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status,
      channel: fulfilment === "DELIVERY" ? "ONLINE" : "TAKEAWAY",
      fulfilment,
      grandTotal: fromRupees("340"),
      ...(fulfilment === "DELIVERY" ? { riderId: TEST_RIDER } : {}),
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("fixture: order insert returned no row");
  return order.id;
}

async function statusOf(orderId: string) {
  const [row] = await db().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  return row?.status;
}

/** Runs `call` while another transaction holds the order row, then lets `whileHeld` write and commit. */
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

describe("completeDelivery result codes", () => {
  let org: TestOrg;
  let otherOrg: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
    otherOrg = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
    await deleteTestOrg(otherOrg.orgId);
  });

  const close = (orderId: string, orgId: string, cashCollected: boolean, roles: readonly ("RIDER" | "KITCHEN")[] = ["RIDER"]) =>
    completeDelivery({ orderId, actorUserId: TEST_RIDER, actorRoles: roles, orgId, cashCollected });

  it("NOT_FOUND for an unknown id and for another org's delivery", async () => {
    expect(await close(randomUUID(), org.orgId, false)).toEqual({ ok: false, code: "NOT_FOUND", error: "That delivery does not exist." });

    const foreign = await createOrder(otherOrg, "DELIVERY", "OUT_FOR_DELIVERY");
    expect(await close(foreign, org.orgId, true)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await statusOf(foreign)).toBe("OUT_FOR_DELIVERY");
  });

  it("NOT_A_DELIVERY for a takeaway order", async () => {
    const orderId = await createOrder(org, "TAKEAWAY", "READY");
    expect(await close(orderId, org.orgId, false)).toEqual({ ok: false, code: "NOT_A_DELIVERY", error: "That order is not a delivery." });
  });

  it.each(["READY", "PAID", "CANCELLED", "REFUNDED"] as const)("NOT_OUT_FOR_DELIVERY for a %s delivery, nothing written", async (status) => {
    const orderId = await createOrder(org, "DELIVERY", status);
    expect(await close(orderId, org.orgId, true)).toEqual({ ok: false, code: "NOT_OUT_FOR_DELIVERY", error: "That order has not left the shop yet." });
    expect(await statusOf(orderId)).toBe(status);
    expect(await db().select().from(payments).where(eq(payments.orderId, orderId))).toHaveLength(0);
  });

  it("ALREADY_CLOSED for a delivery that is already COMPLETED, keeping the old message", async () => {
    const orderId = await createOrder(org, "DELIVERY", "COMPLETED");
    expect(await close(orderId, org.orgId, true)).toEqual({ ok: false, code: "ALREADY_CLOSED", error: "That delivery is already closed." });
  });

  it("PAYMENT_REFUSED when the cash cannot be recorded; the delivery stays open", async () => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    const result = await close(orderId, org.orgId, true, ["KITCHEN"]);
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_REFUSED" });
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
  });

  it("ALREADY_CLOSED, not TRANSITION_REFUSED, when another device completes it after the first read", async () => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    const result = await withOrderRowHeld(
      orderId,
      () => close(orderId, org.orgId, false),
      async (tx) => {
        await tx.update(orders).set({ status: "COMPLETED" }).where(eq(orders.id, orderId));
      },
    );
    expect(result).toEqual({ ok: false, code: "ALREADY_CLOSED", error: "That delivery is already closed." });
  });

  it("TRANSITION_REFUSED when the status moves somewhere else after the first read", async () => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    const result = await withOrderRowHeld(
      orderId,
      () => close(orderId, org.orgId, false),
      async (tx) => {
        await tx.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, orderId));
      },
    );
    expect(result).toMatchObject({ ok: false, code: "TRANSITION_REFUSED" });
    expect(await statusOf(orderId)).toBe("CANCELLED");
  });

  it("TRANSITION_REFUSED for an unpaid delivery closed without cash; it stays open", async () => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    expect(await close(orderId, org.orgId, false)).toMatchObject({ ok: false, code: "TRANSITION_REFUSED" });
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
  });

  it("closes an out-for-delivery order with the cash, no code on success", async () => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    expect(await close(orderId, org.orgId, true)).toEqual({ ok: true });
    expect(await statusOf(orderId)).toBe("COMPLETED");
  });
});

/**
 * reassign-race-1 / complete-release-race: the rider-owns-it check used to be one unlocked read at the top of
 * `completeDelivery`. A manager reassigning (or the rider's hold ending) while the close waited on the order lock
 * left the cash recorded against, and the order completed by, a rider who no longer held the delivery.
 */
describe("completeDelivery: the delivery must still be the closing rider's under the order lock", () => {
  let org: TestOrg;
  const OTHER_RIDER = "00000000-0000-4000-8000-0000000000b2";

  beforeAll(async () => {
    org = await createTestOrg();
  });
  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  const close = (orderId: string, cashCollected: boolean) => completeDelivery({ orderId, actorUserId: TEST_RIDER, actorRoles: ["RIDER"], orgId: org.orgId, cashCollected });

  it.each([true, false])("reassigned to another rider while the close waited (cash %s): refused, no payment, still OUT_FOR_DELIVERY", async (cash) => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    const result = await withOrderRowHeld(
      orderId,
      () => close(orderId, cash),
      async (tx) => {
        await tx.update(orders).set({ riderId: OTHER_RIDER }).where(eq(orders.id, orderId));
      },
    );
    expect(result).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
    expect(await db().select().from(payments).where(eq(payments.orderId, orderId))).toHaveLength(0);
  });

  it("released (rider cleared) while the close waited: refused the same way", async () => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    const result = await withOrderRowHeld(
      orderId,
      () => close(orderId, true),
      async (tx) => {
        await tx.update(orders).set({ riderId: null }).where(eq(orders.id, orderId));
      },
    );
    expect(result).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
    expect(await db().select().from(payments).where(eq(payments.orderId, orderId))).toHaveLength(0);
  });

  it("a rider cannot fail a delivery that was reassigned while the call waited on the lock (red-team c2)", async () => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    const result = await withOrderRowHeld(
      orderId,
      () => failDelivery({ orgId: org.orgId, orderId, actorUserId: TEST_RIDER, actorRoles: ["RIDER"], reason: "customer not home" }),
      async (tx) => {
        await tx.update(orders).set({ riderId: OTHER_RIDER }).where(eq(orders.id, orderId));
      },
    );
    expect(result).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    expect(await statusOf(orderId)).toBe("OUT_FOR_DELIVERY");
  });

  it("the counter (orders.update) still closes any delivery whoever holds it", async () => {
    const orderId = await createOrder(org, "DELIVERY", "OUT_FOR_DELIVERY");
    const result = await completeDelivery({ orderId, actorUserId: randomUUID(), actorRoles: ["CASHIER"], orgId: org.orgId, cashCollected: true });
    expect(result).toEqual({ ok: true });
  });
});
