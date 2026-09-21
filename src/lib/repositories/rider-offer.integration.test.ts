/**
 * rider-offer: an unassigned delivery is OFFERED to every active rider as "Available"; a rider taps
 * "Take it" and it is theirs. The take is one conditional UPDATE, so the first tap wins whatever the
 * timing. Until it is taken the rider sees only what is needed to decide (never the customer's name, phone
 * or address). A rider still closes only their own deliveries; managers can still assign and reassign.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, orderEvents, orderItems, orders, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { completeDelivery } from "./orders";
import { assignRider, listRiderDeliveries, takeDelivery } from "./rider-assignment";

let org: TestOrg;
let other: TestOrg;
const manager = randomUUID();
const riderA = randomUUID();
const riderB = randomUUID();
const riderC = randomUUID();
const cashier = randomUUID();
const outsider = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().insert(memberships).values([
    { orgId: org.orgId, userId: manager, role: "MANAGER", displayName: "Manager" },
    { orgId: org.orgId, userId: riderA, role: "RIDER", displayName: "Rider A" },
    { orgId: org.orgId, userId: riderB, role: "RIDER", displayName: "Rider B" },
    { orgId: org.orgId, userId: riderC, role: "RIDER", displayName: "Rider C" },
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
    await db().delete(orderItems).where(eq(orderItems.orgId, o.orgId));
    await db().delete(orders).where(eq(orders.orgId, o.orgId));
    await db().delete(auditLogs).where(eq(auditLogs.orgId, o.orgId));
  }
});

async function delivery(owner: TestOrg, status: "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "COMPLETED" = "READY", rider: string | null = null): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: owner.orgId,
      locationId: owner.locationId,
      orderNumber: `O-${randomUUID().slice(0, 6)}`,
      businessDate: new Date().toISOString().slice(0, 10),
      status,
      channel: "ONLINE",
      fulfilment: "DELIVERY",
      grandTotal: fromRupees("340"),
      customerName: "Asha Verma",
      customerPhone: "9000000001",
      riderId: rider,
      riderAssignedAt: rider ? new Date() : null,
      deliveryAddress: { line1: "12 Secret Street", landmark: "Behind the temple" },
      deliveryLatMicro: 30_370_000,
      deliveryLngMicro: 76_780_000,
      deliveryDistanceMetres: 2400,
    })
    .returning({ id: orders.id });
  await db().insert(orderItems).values({ orgId: owner.orgId, orderId: row!.id, productName: "OG Smash", quantity: 2, unitPrice: fromRupees("170"), lineSubtotal: fromRupees("340"), lineTotal: fromRupees("340") });
  return row!.id;
}
const row = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
const audit = async (action: string) => db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, action)));
const take = (orderId: string, riderUserId: string, orgId = org.orgId) => takeDelivery({ orgId, orderId, riderUserId });

describe("taking a delivery", () => {
  it("assigns it to the rider, stamps the time, audits it, and it then appears under 'mine'", async () => {
    const id = await delivery(org);
    expect(await take(id, riderA)).toEqual({ ok: true, changed: true });
    expect(await row(id)).toMatchObject({ riderId: riderA });
    expect((await row(id)).riderAssignedAt).toBeInstanceOf(Date);
    expect((await audit("rider_took_delivery"))[0]).toMatchObject({ actorUserId: riderA, entityId: id, before: { riderId: null }, after: { riderId: riderA } });
    const view = await listRiderDeliveries(org.orgId, riderA);
    expect(view.mine.map((d) => d.id)).toEqual([id]);
    expect(view.offers).toEqual([]);
  });

  it("the first tap wins: many riders tapping at once, exactly one gets it and the others are told it is taken", async () => {
    const id = await delivery(org);
    const results = await Promise.all([take(id, riderA), take(id, riderB), take(id, riderC), take(id, riderA), take(id, riderB), take(id, riderC)]);
    const winnerId = (await row(id)).riderId;
    expect([riderA, riderB, riderC]).toContain(winnerId);
    for (const [index, riderId] of [riderA, riderB, riderC, riderA, riderB, riderC].entries()) {
      const result = results[index]!;
      if (riderId === winnerId) expect(result.ok, `tap ${index}`).toBe(true);
      else expect(result, `tap ${index}`).toMatchObject({ ok: false, code: "ALREADY_TAKEN" });
    }
    expect(await audit("rider_took_delivery")).toHaveLength(1); // one winner, one audit row
  });

  it("taking your own delivery again changes nothing and writes no second audit row", async () => {
    const id = await delivery(org);
    await take(id, riderA);
    expect(await take(id, riderA)).toEqual({ ok: true, changed: false });
    expect(await audit("rider_took_delivery")).toHaveLength(1);
  });

  it("another rider cannot take one already assigned (not even one a manager assigned)", async () => {
    const id = await delivery(org);
    await assignRider({ orgId: org.orgId, orderId: id, riderUserId: riderA, actorUserId: manager });
    expect(await take(id, riderB)).toMatchObject({ ok: false, code: "ALREADY_TAKEN" });
    expect((await row(id)).riderId).toBe(riderA);
  });

  it("refused: a person who is not an active rider of this org, another org's delivery, a delivery still being cooked, a closed one, a takeaway", async () => {
    const id = await delivery(org);
    expect(await take(id, cashier)).toMatchObject({ ok: false, code: "NOT_A_RIDER" });
    expect(await take(id, outsider)).toMatchObject({ ok: false, code: "NOT_A_RIDER" });
    const foreign = await delivery(other);
    expect(await take(foreign, riderA)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await row(foreign)).riderId).toBeNull();
    const cooking = await delivery(org, "PREPARING");
    expect(await take(cooking, riderA)).toMatchObject({ ok: false, code: "NOT_AVAILABLE" });
    const done = await delivery(org, "COMPLETED");
    expect(await take(done, riderA)).toMatchObject({ ok: false, code: "NOT_AVAILABLE" });
    const [takeaway] = await db().insert(orders).values({ orgId: org.orgId, locationId: org.locationId, orderNumber: `T-${randomUUID().slice(0, 6)}`, businessDate: new Date().toISOString().slice(0, 10), status: "READY", channel: "TAKEAWAY", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100") }).returning({ id: orders.id });
    expect(await take(takeaway!.id, riderA)).toMatchObject({ ok: false, code: "NOT_A_DELIVERY" });
    expect((await row(id)).riderId).toBeNull();
    expect(await audit("rider_took_delivery")).toHaveLength(0);
  });
});

describe("what a rider sees", () => {
  it("every active rider sees an unassigned ready delivery as Available, with pickup-level details only", async () => {
    const id = await delivery(org, "READY");
    for (const rider of [riderA, riderB, riderC]) {
      const { offers, mine } = await listRiderDeliveries(org.orgId, rider);
      expect(mine).toEqual([]);
      expect(offers.map((o) => o.id)).toEqual([id]);
    }
  });

  it("an offer carries no customer name, phone, address, landmark or coordinates: exactly the pickup-level keys", async () => {
    await delivery(org, "READY");
    const [offer] = (await listRiderDeliveries(org.orgId, riderA)).offers;
    expect(Object.keys(offer!).sort()).toEqual(["distanceMetres", "grandTotal", "id", "isPaid", "itemCount", "orderNumber", "placedAt"].sort());
    expect(JSON.stringify(offer, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/9000000001|Asha|Secret Street|temple|30370000|76780000/);
    expect(offer).toMatchObject({ itemCount: 2, distanceMetres: 2400 });
  });

  it("the full details (customer, phone, address) appear only after the rider has taken it", async () => {
    const id = await delivery(org, "READY");
    await take(id, riderA);
    const [mine] = (await listRiderDeliveries(org.orgId, riderA)).mine;
    expect(mine).toMatchObject({ id, customerPhone: "9000000001", customerName: "Asha Verma" });
    expect(mine!.delivery?.line1).toBe("12 Secret Street");
    // and the other riders no longer see it at all
    for (const rider of [riderB, riderC]) {
      const view = await listRiderDeliveries(org.orgId, rider);
      expect(view.offers).toEqual([]);
      expect(view.mine).toEqual([]);
    }
  });

  it("a delivery still being cooked, a takeaway and another org's delivery are not offered; a rider never sees another rider's delivery", async () => {
    await delivery(org, "PREPARING");
    await delivery(other, "READY");
    const bs = await delivery(org, "OUT_FOR_DELIVERY", riderB);
    const view = await listRiderDeliveries(org.orgId, riderA);
    expect(view.offers).toEqual([]);
    expect(view.mine.map((d) => d.id)).not.toContain(bs);
  });
});

describe("closing and managing are unchanged", () => {
  it("a rider still closes only their own delivery: taking does not let another rider close it, and an untaken offer cannot be closed", async () => {
    const id = await delivery(org, "OUT_FOR_DELIVERY");
    expect(await completeDelivery({ orderId: id, actorUserId: riderA, actorRoles: ["RIDER"], orgId: org.orgId, cashCollected: true })).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    await take(id, riderA);
    expect(await completeDelivery({ orderId: id, actorUserId: riderB, actorRoles: ["RIDER"], orgId: org.orgId, cashCollected: true })).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    expect(await completeDelivery({ orderId: id, actorUserId: riderA, actorRoles: ["RIDER"], orgId: org.orgId, cashCollected: true })).toEqual({ ok: true });
  });

  it("a manager can still reassign a delivery a rider took", async () => {
    const id = await delivery(org, "READY");
    await take(id, riderA);
    expect(await assignRider({ orgId: org.orgId, orderId: id, riderUserId: riderB, actorUserId: manager })).toEqual({ ok: true, changed: true });
    expect((await row(id)).riderId).toBe(riderB);
  });
});
