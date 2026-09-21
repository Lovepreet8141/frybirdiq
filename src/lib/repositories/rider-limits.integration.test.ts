/**
 * rider-take-cap and the release button (owner decisions, 2026-09-21): a rider holds at most 2 active deliveries, "Take it"
 * beyond that is refused, the count cannot be beaten by tapping many at once, and "Release" gives a delivery back to Available.
 * Every take and release is audited.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, orderItems, orders, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { assignRider, listRiderDeliveries, releaseDelivery, takeDelivery } from "./rider-assignment";

let org: TestOrg;
let other: TestOrg;
const manager = randomUUID();
const riderA = randomUUID();
const riderB = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().insert(memberships).values([
    { orgId: org.orgId, userId: manager, role: "MANAGER" },
    { orgId: org.orgId, userId: riderA, role: "RIDER", displayName: "Rider A" },
    { orgId: org.orgId, userId: riderB, role: "RIDER", displayName: "Rider B" },
  ]);
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});
beforeEach(async () => {
  for (const o of [org, other]) {
    await db().delete(payments).where(eq(payments.orgId, o.orgId));
    await db().delete(orderItems).where(eq(orderItems.orgId, o.orgId));
    await db().delete(orders).where(eq(orders.orgId, o.orgId));
    await db().delete(auditLogs).where(eq(auditLogs.orgId, o.orgId));
  }
});

async function delivery(owner: TestOrg, status: "READY" | "OUT_FOR_DELIVERY" | "COMPLETED" = "READY", rider: string | null = null): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({ orgId: owner.orgId, locationId: owner.locationId, orderNumber: `L-${randomUUID().slice(0, 6)}`, businessDate: new Date().toISOString().slice(0, 10), status, channel: "ONLINE", fulfilment: "DELIVERY", grandTotal: fromRupees("200"), riderId: rider, riderAssignedAt: rider ? new Date() : null })
    .returning({ id: orders.id });
  return row!.id;
}
const row = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
const audit = async (action: string) => db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, action)));
const take = (orderId: string, riderUserId = riderA, orgId = org.orgId) => takeDelivery({ orgId, orderId, riderUserId });
const release = (orderId: string, riderUserId = riderA, orgId = org.orgId) => releaseDelivery({ orgId, orderId, riderUserId });

describe("a rider holds at most 2 active deliveries", () => {
  it("takes two, and the third is refused with a clear reason: nothing changes", async () => {
    const [a, b, c] = [await delivery(org), await delivery(org), await delivery(org)];
    expect(await take(a!)).toMatchObject({ ok: true });
    expect(await take(b!)).toMatchObject({ ok: true });
    expect(await take(c!)).toMatchObject({ ok: false, code: "AT_LIMIT" });
    expect((await row(c!)).riderId).toBeNull();
    expect(await audit("rider_took_delivery")).toHaveLength(2);
  });

  it("a burst of taps on many deliveries at once still ends with exactly 2", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => delivery(org)));
    const results = await Promise.all(ids.map((id) => take(id)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.code === "AT_LIMIT")).toHaveLength(4);
    const held = await db().select().from(orders).where(and(eq(orders.orgId, org.orgId), eq(orders.riderId, riderA)));
    expect(held).toHaveLength(2);
  });

  it("the limit is per rider, and counts only active deliveries: a completed one frees a place", async () => {
    await delivery(org, "COMPLETED", riderA);
    await delivery(org, "COMPLETED", riderA);
    await delivery(org, "READY", riderA);
    expect(await take(await delivery(org))).toMatchObject({ ok: true }); // 1 active + this = 2
    expect(await take(await delivery(org))).toMatchObject({ ok: false, code: "AT_LIMIT" });
    expect(await take(await delivery(org), riderB)).toMatchObject({ ok: true }); // another rider has their own 2
  });

  it("taking a delivery you already hold is still a no-op when you are at the limit", async () => {
    const [a, b] = [await delivery(org), await delivery(org)];
    await take(a!);
    await take(b!);
    expect(await take(a!)).toEqual({ ok: true, changed: false });
  });

  it("a manager can still assign beyond the limit (the cap is on riders choosing for themselves)", async () => {
    await take(await delivery(org));
    await take(await delivery(org));
    const c = await delivery(org);
    expect(await assignRider({ orgId: org.orgId, orderId: c, riderUserId: riderA, actorUserId: manager })).toMatchObject({ ok: true });
    expect((await row(c)).riderId).toBe(riderA);
  });

  it("the offer list tells the screen when the rider is at the limit", async () => {
    await delivery(org);
    expect((await listRiderDeliveries(org.orgId, riderA)).atLimit).toBe(false);
    await take(await delivery(org));
    await take(await delivery(org));
    const view = await listRiderDeliveries(org.orgId, riderA);
    expect(view.atLimit).toBe(true);
    expect(view.mine).toHaveLength(2);
  });
});

describe("Release gives a delivery back to Available", () => {
  it("clears the rider, audits it, offers it to every rider again, and frees the place", async () => {
    const [a, b] = [await delivery(org), await delivery(org)];
    await take(a!);
    await take(b!);
    expect(await release(a!)).toEqual({ ok: true });
    expect(await row(a!)).toMatchObject({ riderId: null, riderAssignedAt: null });
    expect((await audit("rider_released_delivery"))[0]).toMatchObject({ actorUserId: riderA, entityId: a, before: { riderId: riderA }, after: { riderId: null } });
    expect((await listRiderDeliveries(org.orgId, riderB)).offers.map((o) => o.id)).toEqual([a]);
    expect(await take(await delivery(org))).toMatchObject({ ok: true }); // a place is free again
  });

  it("first tap wins again after a release: the other rider can take it", async () => {
    const a = await delivery(org);
    await take(a);
    await release(a);
    expect(await take(a, riderB)).toMatchObject({ ok: true });
    expect((await row(a)).riderId).toBe(riderB);
  });

  it("only the holder can release: another rider, an unassigned delivery, another org's, a closed one are refused and nothing changes", async () => {
    const a = await delivery(org);
    await take(a);
    expect(await release(a, riderB)).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    expect((await row(a)).riderId).toBe(riderA);
    const unassigned = await delivery(org);
    expect(await release(unassigned)).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    const foreign = await delivery(other, "READY", riderA);
    expect(await release(foreign)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await row(foreign)).riderId).toBe(riderA);
    const done = await delivery(org, "COMPLETED", riderA);
    expect(await release(done)).toMatchObject({ ok: false, code: "NOT_RELEASABLE" });
    expect((await row(done)).riderId).toBe(riderA);
    expect(await audit("rider_released_delivery")).toHaveLength(0);
  });

  it("releasing twice releases once: the second is refused and writes no second audit row", async () => {
    const a = await delivery(org);
    await take(a);
    await release(a);
    expect(await release(a)).toMatchObject({ ok: false });
    expect(await audit("rider_released_delivery")).toHaveLength(1);
  });

  it("a delivery already out on the road can be released too (the rider cannot make it), then it is Available", async () => {
    const a = await delivery(org, "OUT_FOR_DELIVERY", riderA);
    expect(await release(a)).toEqual({ ok: true });
    expect((await listRiderDeliveries(org.orgId, riderB)).offers.map((o) => o.id)).toEqual([a]);
  });
});
