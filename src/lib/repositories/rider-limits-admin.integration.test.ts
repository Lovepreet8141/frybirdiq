/**
 * rider-limits-admin: the two rider limits come from the org's own settings, not constants. Changing them changes the
 * next "Take it" (and the rider's at-limit state), the change is audited with old and new values, the database refuses
 * out-of-bounds values even on a hand edit, and one org's limits never touch another's.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, orderItems, orders, organizations, payments } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { getRiderLimits, listRiderDeliveries, takeDelivery } from "./rider-assignment";
import { updateRiderLimits } from "./settings";

let org: TestOrg;
let other: TestOrg;
const owner = randomUUID();
const rider = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().insert(memberships).values([
    { orgId: org.orgId, userId: owner, role: "OWNER" },
    { orgId: org.orgId, userId: rider, role: "RIDER", displayName: "Rider" },
    { orgId: other.orgId, userId: rider, role: "RIDER", displayName: "Rider elsewhere" },
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
    await db().update(organizations).set({ riderMaxActive: 2, riderMaxTakesPerHour: 6 }).where(eq(organizations.id, o.orgId));
  }
});

async function delivery(owning: TestOrg): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({ orgId: owning.orgId, locationId: owning.locationId, orderNumber: `R-${randomUUID().slice(0, 6)}`, businessDate: new Date().toISOString().slice(0, 10), status: "READY", channel: "ONLINE", fulfilment: "DELIVERY", grandTotal: fromRupees("200") })
    .returning({ id: orders.id });
  return row!.id;
}
const take = (orderId: string, orgId = org.orgId) => takeDelivery({ orgId, orderId, riderUserId: rider });

describe("rider limits come from the org's settings", () => {
  it("a new org starts with the accepted figures, 2 and 6", async () => {
    expect(await getRiderLimits(org.orgId)).toEqual({ maxActive: 2, maxTakesPerHour: 6 });
  });

  it("lowering the active limit to 1 refuses the second take, with the new number in the message", async () => {
    await updateRiderLimits(org.orgId, owner, { maxActive: 1, maxTakesPerHour: 6 });
    expect(await take(await delivery(org))).toMatchObject({ ok: true });
    const second = await take(await delivery(org));
    expect(second).toMatchObject({ ok: false, code: "AT_LIMIT" });
    if (!second.ok) expect(second.error).toContain("1 delivery");
    expect((await listRiderDeliveries(org.orgId, rider)).atLimit).toBe(true);
  });

  it("raising the active limit to 3 lets a third take through, and the rider's screen is not at limit until then", async () => {
    await updateRiderLimits(org.orgId, owner, { maxActive: 3, maxTakesPerHour: 6 });
    for (let n = 0; n < 2; n++) expect(await take(await delivery(org))).toMatchObject({ ok: true });
    expect((await listRiderDeliveries(org.orgId, rider)).atLimit).toBe(false);
    expect(await take(await delivery(org))).toMatchObject({ ok: true });
    expect(await take(await delivery(org))).toMatchObject({ ok: false, code: "AT_LIMIT" });
    expect((await listRiderDeliveries(org.orgId, rider)).atLimit).toBe(true);
  });

  it("the takes-per-hour limit is the org's: 2 takes per hour refuses the third even with room to hold it", async () => {
    await updateRiderLimits(org.orgId, owner, { maxActive: 5, maxTakesPerHour: 2 });
    for (let n = 0; n < 2; n++) expect(await take(await delivery(org))).toMatchObject({ ok: true });
    expect(await take(await delivery(org))).toMatchObject({ ok: false, code: "TOO_MANY_TAKES" });
  });

  it("one org's limits do not touch another's", async () => {
    await updateRiderLimits(org.orgId, owner, { maxActive: 1, maxTakesPerHour: 1 });
    expect(await getRiderLimits(other.orgId)).toEqual({ maxActive: 2, maxTakesPerHour: 6 });
    for (let n = 0; n < 2; n++) expect(await take(await delivery(other), other.orgId)).toMatchObject({ ok: true });
  });
});

describe("changing the limits is audited and bounded", () => {
  it("writes one audit row with the old and new values, against the person who changed them", async () => {
    await updateRiderLimits(org.orgId, owner, { maxActive: 4, maxTakesPerHour: 12 });
    const rows = await db().select().from(auditLogs).where(and(eq(auditLogs.orgId, org.orgId), eq(auditLogs.action, "rider_limits_changed")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: owner, entity: "organizations", entityId: org.orgId, before: { maxActive: 2, maxTakesPerHour: 6 }, after: { maxActive: 4, maxTakesPerHour: 12 } });
  });

  it.each([
    ["active 0", { riderMaxActive: 0 }],
    ["active 6", { riderMaxActive: 6 }],
    ["takes 0 (the cap cannot be switched off)", { riderMaxTakesPerHour: 0 }],
    ["takes 21", { riderMaxTakesPerHour: 21 }],
  ])("the database itself refuses %s, even on a hand edit", async (_name, values) => {
    await expect(db().update(organizations).set(values).where(eq(organizations.id, org.orgId))).rejects.toThrow();
    expect(await getRiderLimits(org.orgId)).toEqual({ maxActive: 2, maxTakesPerHour: 6 });
  });
});
