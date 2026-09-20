/**
 * Rider assignment (roadmap 6.3): a delivery has one rider; a rider sees and
 * closes only their own deliveries; a delivery that cannot be made is FAILED with
 * a reason. Every refusal is server-side: hiding a button is not authorization.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, orderEvents, orders, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { completeDelivery, listDeliveries } from "./orders";
import { assignRider, failDelivery, listAssignableRiders } from "./rider-assignment";

let org: TestOrg;
let other: TestOrg;
const manager = randomUUID();
const riderA = randomUUID();
const riderB = randomUUID();
const cashier = randomUUID();
const outsider = randomUUID(); // a rider of ANOTHER org

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().insert(memberships).values([
    { orgId: org.orgId, userId: manager, role: "MANAGER", displayName: "Manager" },
    { orgId: org.orgId, userId: riderA, role: "RIDER", displayName: "Rider A" },
    { orgId: org.orgId, userId: riderB, role: "RIDER", displayName: "Rider B" },
    { orgId: org.orgId, userId: cashier, role: "CASHIER", displayName: "Cashier" },
    { orgId: other.orgId, userId: outsider, role: "RIDER", displayName: "Outsider" },
  ]);
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});
beforeEach(async () => {
  for (const o of [org, other]) {
    await db().delete(payments).where(eq(payments.orgId, o.orgId));
    await db().delete(orderEvents).where(eq(orderEvents.orgId, o.orgId));
    await db().delete(orders).where(eq(orders.orgId, o.orgId));
    await db().delete(auditLogs).where(eq(auditLogs.orgId, o.orgId));
  }
});

async function delivery(owner: TestOrg, status: "READY" | "OUT_FOR_DELIVERY" | "COMPLETED" = "OUT_FOR_DELIVERY", rider: string | null = null, rupees = "300"): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: owner.orgId,
      locationId: owner.locationId,
      orderNumber: `R-${randomUUID().slice(0, 8)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status,
      channel: "ONLINE",
      fulfilment: "DELIVERY",
      grandTotal: fromRupees(rupees),
      riderId: rider,
      riderAssignedAt: rider ? new Date() : null,
    })
    .returning({ id: orders.id });
  return row!.id;
}
const row = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
const audit = async (action: string) => db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, action)));
const assign = (orderId: string, riderUserId: string, orgId = org.orgId) => assignRider({ orgId, orderId, riderUserId, actorUserId: manager });

describe("assigning a rider", () => {
  it("stores the rider, stamps the time, and audits who assigned whom", async () => {
    const id = await delivery(org, "READY");
    expect(await assign(id, riderA)).toEqual({ ok: true, changed: true });
    expect(await row(id)).toMatchObject({ riderId: riderA });
    expect((await row(id)).riderAssignedAt).toBeInstanceOf(Date);
    const [entry] = await audit("rider_assigned");
    expect(entry).toMatchObject({ actorUserId: manager, entityId: id, before: { riderId: null }, after: { riderId: riderA } });
  });

  it("assigning the same rider again changes nothing and writes no second audit row", async () => {
    const id = await delivery(org, "READY");
    await assign(id, riderA);
    expect(await assign(id, riderA)).toEqual({ ok: true, changed: false });
    expect(await audit("rider_assigned")).toHaveLength(1);
  });

  it("reassigning to another rider is allowed while the delivery is open, with before and after in the audit row", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    expect(await assign(id, riderB)).toEqual({ ok: true, changed: true });
    expect((await row(id)).riderId).toBe(riderB);
    const entries = await audit("rider_assigned");
    expect(entries[0]).toMatchObject({ before: { riderId: riderA }, after: { riderId: riderB } });
  });

  it("refuses: a person who is not an active rider of this org, another org's order, a takeaway order, a closed delivery", async () => {
    const id = await delivery(org, "READY");
    expect(await assign(id, cashier)).toMatchObject({ ok: false, code: "NOT_A_RIDER" });
    expect(await assign(id, outsider)).toMatchObject({ ok: false, code: "NOT_A_RIDER" }); // a rider, but of another org
    expect(await assign(id, randomUUID())).toMatchObject({ ok: false, code: "NOT_A_RIDER" });
    const foreign = await delivery(other, "READY");
    expect(await assign(foreign, riderA)).toMatchObject({ ok: false, code: "NOT_FOUND" }); // scoped by org
    expect((await row(foreign)).riderId).toBeNull();
    const [takeaway] = await db().insert(orders).values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `T-${randomUUID().slice(0, 8)}`, businessDate: new Date().toISOString().slice(0, 10), status: "READY", channel: "TAKEAWAY", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100") }).returning({ id: orders.id });
    expect(await assign(takeaway!.id, riderA)).toMatchObject({ ok: false, code: "NOT_A_DELIVERY" });
    const done = await delivery(org, "COMPLETED");
    expect(await assign(done, riderA)).toMatchObject({ ok: false, code: "ORDER_CLOSED" });
    expect((await row(id)).riderId).toBeNull();
    expect(await audit("rider_assigned")).toHaveLength(0);
  });

  it("a deactivated rider cannot be assigned", async () => {
    const gone = randomUUID();
    await db().insert(memberships).values({ orgId: org.orgId, userId: gone, role: "RIDER", displayName: "Gone", isActive: false });
    const id = await delivery(org, "READY");
    expect(await assign(id, gone)).toMatchObject({ ok: false, code: "NOT_A_RIDER" });
  });

  it("the database refuses a rider on an order that is not a delivery", async () => {
    await expect(
      db().insert(orders).values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `X-${randomUUID().slice(0, 8)}`, businessDate: new Date().toISOString().slice(0, 10), status: "READY", channel: "TAKEAWAY", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100"), riderId: riderA }),
    ).rejects.toThrow();
  });

  it("lists this org's active riders only, by name", async () => {
    const riders = await listAssignableRiders(org.orgId);
    expect(riders.map((r) => r.displayName).sort()).toEqual(["Rider A", "Rider B"]);
  });
});

describe("a rider sees only their own deliveries", () => {
  it("two riders get disjoint lists; the counter (no rider filter) sees all", async () => {
    const a1 = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    const a2 = await delivery(org, "READY", riderA);
    const b1 = await delivery(org, "OUT_FOR_DELIVERY", riderB);
    const unassigned = await delivery(org, "READY");
    const ids = async (opts?: { onlyRiderUserId?: string }) => (await listDeliveries(org.orgId, opts)).map((d) => d.id).sort();
    expect(await ids({ onlyRiderUserId: riderA })).toEqual([a1, a2].sort());
    expect(await ids({ onlyRiderUserId: riderB })).toEqual([b1]);
    expect(await ids()).toEqual([a1, a2, b1, unassigned].sort());
    // an unassigned delivery is on nobody's rider list
    expect(await ids({ onlyRiderUserId: riderA })).not.toContain(unassigned);
  });

  it("another org's deliveries never appear", async () => {
    const foreign = await delivery(other, "OUT_FOR_DELIVERY", outsider);
    expect((await listDeliveries(org.orgId)).map((d) => d.id)).not.toContain(foreign);
  });
});

describe("closing a delivery is limited to its rider (server-side)", () => {
  const close = (orderId: string, actorUserId: string, roles: ("RIDER" | "CASHIER" | "MANAGER")[]) => completeDelivery({ orderId, actorUserId, actorRoles: roles, orgId: org.orgId, cashCollected: true });

  it("another rider cannot close it: refused, nothing recorded, order unchanged", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    expect(await close(id, riderB, ["RIDER"])).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    expect((await row(id)).status).toBe("OUT_FOR_DELIVERY");
    expect(await db().select().from(payments).where(eq(payments.orderId, id))).toEqual([]);
  });

  it("a rider cannot close a delivery nobody assigned to them", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY");
    expect(await close(id, riderA, ["RIDER"])).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
  });

  it("the assigned rider closes it and the cash is recorded against them", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    expect(await close(id, riderA, ["RIDER"])).toEqual({ ok: true });
    expect((await row(id)).status).toBe("COMPLETED");
    const [payment] = await db().select().from(payments).where(eq(payments.orderId, id));
    expect(payment).toMatchObject({ collectedBy: riderA, heldByRider: true });
  });

  it("the counter can still close any delivery when a rider cannot", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    expect(await close(id, cashier, ["CASHIER"])).toEqual({ ok: true });
    const id2 = await delivery(org, "OUT_FOR_DELIVERY");
    expect(await close(id2, manager, ["MANAGER"])).toEqual({ ok: true });
  });
});

describe("a delivery that cannot be made", () => {
  const fail = (orderId: string, actorUserId: string, roles: ("RIDER" | "MANAGER")[], reason: string, orgId = org.orgId) => failDelivery({ orgId, orderId, actorUserId, actorRoles: roles, reason });

  it("the assigned rider records FAILED with a reason: status, event reason and audit row", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    expect(await fail(id, riderA, ["RIDER"], "Customer not answering the phone")).toEqual({ ok: true });
    expect((await row(id)).status).toBe("FAILED");
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, id));
    expect(events.find((e) => e.toStatus === "FAILED")).toMatchObject({ fromStatus: "OUT_FOR_DELIVERY", actorUserId: riderA, reason: "Customer not answering the phone" });
    expect((await audit("delivery_failed"))[0]).toMatchObject({ actorUserId: riderA, entityId: id, after: { reason: "Customer not answering the phone" } });
  });

  it("refused: a blank or tiny reason, another rider's delivery, a delivery still in the shop, another org's order", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    expect(await fail(id, riderA, ["RIDER"], "  ")).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(await fail(id, riderA, ["RIDER"], "no")).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(await fail(id, riderB, ["RIDER"], "Wrong address")).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    const ready = await delivery(org, "READY", riderA);
    expect(await fail(ready, riderA, ["RIDER"], "Wrong address")).toMatchObject({ ok: false, code: "NOT_OUT_FOR_DELIVERY" });
    const foreign = await delivery(other, "OUT_FOR_DELIVERY", outsider);
    expect(await fail(foreign, riderA, ["RIDER"], "Wrong address")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await row(id)).status).toBe("OUT_FOR_DELIVERY");
    expect((await row(foreign)).status).toBe("OUT_FOR_DELIVERY");
  });

  it("an order that already took money is never failed here (that needs a refund by a manager)", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    await db().insert(payments).values({ orgId: org.orgId, orderId: id, status: "CAPTURED", method: "UPI", amount: fromRupees("300"), provider: "razorpay" });
    expect(await fail(id, riderA, ["RIDER"], "Customer unreachable")).toMatchObject({ ok: false, code: "ALREADY_PAID" });
    expect((await row(id)).status).toBe("OUT_FOR_DELIVERY");
  });

  it("a manager can fail any delivery with a reason", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    expect(await fail(id, manager, ["MANAGER"], "Rider had an accident, order abandoned")).toEqual({ ok: true });
  });

  it("failing twice is refused the second time and writes one audit row", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    await fail(id, riderA, ["RIDER"], "Customer not answering");
    expect(await fail(id, riderA, ["RIDER"], "Customer not answering")).toMatchObject({ ok: false });
    expect(await audit("delivery_failed")).toHaveLength(1);
  });
});
