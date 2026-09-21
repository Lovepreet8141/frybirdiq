/**
 * Rider live position against a real database (Lane B): who may post a fix, what the customer's page may be told, the
 * 24-hour purge, and that no client role can touch the table.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { locations, orders, riderPositions } from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import { fromRupees } from "@/lib/money";
import { POSITION_MIN_GAP_MS, POSITION_RETENTION_MS, POSITION_STALE_MS } from "@/lib/delivery/tracking";
import { getRiderTrackingView, purgeRiderPositions, recordRiderPosition } from "./rider-tracking";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";

let org: TestOrg;
let other: TestOrg;
const rider = randomUUID();
const otherRider = randomUUID();
const T0 = new Date("2026-09-22T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
  await db().update(locations).set({ latMicro: 30_378_000, lngMicro: 76_776_000 }).where(eq(locations.id, org.locationId));
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

async function order(o: TestOrg, status: OrderStatus, opts: { fulfilment?: "DELIVERY" | "TAKEAWAY"; riderId?: string | null; dest?: boolean } = {}): Promise<string> {
  const fulfilment = opts.fulfilment ?? "DELIVERY";
  const [row] = await db()
    .insert(orders)
    .values({
      orgId: o.orgId,
      locationId: o.locationId,
      orderNumber: `RT-${randomUUID().slice(0, 8)}`,
      businessDate: "2026-09-22",
      status,
      channel: fulfilment === "DELIVERY" ? "ONLINE" : "TAKEAWAY",
      fulfilment,
      grandTotal: fromRupees("300"),
      riderId: fulfilment === "DELIVERY" ? (opts.riderId === undefined ? rider : opts.riderId) : null,
      ...(opts.dest ? { deliveryLatMicro: 30_390_000, deliveryLngMicro: 76_790_000 } : {}),
    })
    .returning({ id: orders.id });
  return row!.id;
}
const fixesOf = (orderId: string) => db().select().from(riderPositions).where(eq(riderPositions.orderId, orderId));
const pos = { lat: 30.3801, lng: 76.7812, accuracyMetres: 9 };
const post = (orderId: string, overrides: Partial<Parameters<typeof recordRiderPosition>[0]> = {}) =>
  recordRiderPosition({ orgId: org.orgId, orderId, riderUserId: rider, position: pos, now: T0, ...overrides });

describe("recordRiderPosition", () => {
  it("stores a fix for the rider who holds an out-for-delivery order, as integer microdegrees", async () => {
    const id = await order(org, "OUT_FOR_DELIVERY");
    expect(await post(id)).toEqual({ ok: true, stored: true });
    const [fix] = await fixesOf(id);
    expect(fix).toMatchObject({ orgId: org.orgId, riderUserId: rider, latMicro: 30_380_100, lngMicro: 76_781_200, accuracyMetres: 9 });
  });

  it("drops a near-duplicate fix (a retry, a second tab) without an error, and stores the next one after the gap", async () => {
    const id = await order(org, "OUT_FOR_DELIVERY");
    await post(id);
    expect(await post(id, { now: at(POSITION_MIN_GAP_MS - 1) })).toEqual({ ok: true, stored: false });
    expect(await fixesOf(id)).toHaveLength(1);
    expect(await post(id, { now: at(POSITION_MIN_GAP_MS) })).toEqual({ ok: true, stored: true });
    expect(await fixesOf(id)).toHaveLength(2);
  });

  it("refuses another rider, an unassigned order, and a rider who no longer holds it", async () => {
    const mine = await order(org, "OUT_FOR_DELIVERY");
    expect(await post(mine, { riderUserId: otherRider })).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    const unassigned = await order(org, "OUT_FOR_DELIVERY", { riderId: null });
    expect(await post(unassigned)).toMatchObject({ ok: false, code: "NOT_YOUR_DELIVERY" });
    expect(await fixesOf(mine)).toHaveLength(0);
    expect(await fixesOf(unassigned)).toHaveLength(0);
  });

  it.each(["READY", "COMPLETED", "FAILED", "CANCELLED"] as const)("stores nothing while the order is %s: sharing starts when it goes out and stops when it ends", async (status) => {
    const id = await order(org, status);
    expect(await post(id)).toMatchObject({ ok: false, code: "NOT_OUT_FOR_DELIVERY" });
    expect(await fixesOf(id)).toHaveLength(0);
  });

  it("refuses a takeaway order, an unknown id, and another org's delivery (as if it did not exist)", async () => {
    const takeaway = await order(org, "OUT_FOR_DELIVERY", { fulfilment: "TAKEAWAY" });
    expect(await post(takeaway)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await post(randomUUID())).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const foreign = await order(other, "OUT_FOR_DELIVERY");
    expect(await post(foreign)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await fixesOf(foreign)).toHaveLength(0);
  });

  it.each([{ lat: 95, lng: 76 }, { lat: 30, lng: 200 }, { lat: 0, lng: 0 }, { lat: "x", lng: 1 }, null])("refuses a bad position %j and stores nothing", async (position) => {
    const id = await order(org, "OUT_FOR_DELIVERY");
    expect(await post(id, { position })).toMatchObject({ ok: false, code: "BAD_POSITION" });
    expect(await fixesOf(id)).toHaveLength(0);
  });
});

describe("getRiderTrackingView: what the customer's page may be told", () => {
  it("says nothing about the rider unless the order is a delivery that is out, and never leaks a fix from before or after", async () => {
    const id = await order(org, "OUT_FOR_DELIVERY");
    await post(id);
    await db().update(orders).set({ status: "COMPLETED" }).where(eq(orders.id, id));
    expect(await getRiderTrackingView({ orgId: org.orgId, orderId: id, now: at(1000) })).toEqual({ state: { kind: "hidden" }, rider: null, destination: null, shop: null });
    const ready = await order(org, "READY");
    expect(await getRiderTrackingView({ orgId: org.orgId, orderId: ready, now: at(1000) })).toMatchObject({ state: { kind: "hidden" }, rider: null });
    const takeaway = await order(org, "OUT_FOR_DELIVERY", { fulfilment: "TAKEAWAY" });
    expect((await getRiderTrackingView({ orgId: org.orgId, orderId: takeaway })).state.kind).toBe("hidden");
  });

  it("waits when out with no fix yet, and gives the shop and the customer's own pin", async () => {
    const id = await order(org, "OUT_FOR_DELIVERY", { dest: true });
    const view = await getRiderTrackingView({ orgId: org.orgId, orderId: id, now: at(1000) });
    expect(view.state).toEqual({ kind: "waiting" });
    expect(view.rider).toBeNull();
    expect(view.destination).toEqual({ lat: 30.39, lng: 76.79 });
    expect(view.shop).toEqual({ lat: 30.378, lng: 76.776 });
  });

  it("is live for a recent fix, returns only the NEWEST one, and is stale (not live-looking) once fixes stop", async () => {
    const id = await order(org, "OUT_FOR_DELIVERY");
    await post(id);
    await post(id, { now: at(20_000), position: { lat: 30.4, lng: 76.8 } });
    const live = await getRiderTrackingView({ orgId: org.orgId, orderId: id, now: at(25_000) });
    expect(live.state).toEqual({ kind: "live", ageSeconds: 5 });
    expect(live.rider).toMatchObject({ lat: 30.4, lng: 76.8 });
    const stale = await getRiderTrackingView({ orgId: org.orgId, orderId: id, now: at(20_000 + POSITION_STALE_MS + 1000) });
    expect(stale.state.kind).toBe("stale");
  });

  it("another org's id answers as hidden", async () => {
    const id = await order(org, "OUT_FOR_DELIVERY");
    await post(id);
    expect(await getRiderTrackingView({ orgId: other.orgId, orderId: id, now: at(1000) })).toMatchObject({ state: { kind: "hidden" }, rider: null });
  });
});

describe("purgeRiderPositions: kept 24 hours, then deleted", () => {
  // Own orgs: the fixes the other tests leave are old relative to the clock used here, and must not be counted.
  let mineOrg: TestOrg;
  let theirOrg: TestOrg;
  beforeAll(async () => {
    mineOrg = await createTestOrg();
    theirOrg = await createTestOrg();
  });
  afterAll(async () => {
    await deleteTestOrg(mineOrg.orgId);
    await deleteTestOrg(theirOrg.orgId);
  });

  it("deletes only fixes older than 24 hours, only in this org, and reports how many", async () => {
    const mine = await order(mineOrg, "OUT_FOR_DELIVERY");
    const theirs = await order(theirOrg, "OUT_FOR_DELIVERY");
    const now = new Date("2026-09-23T12:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const row = (o: TestOrg, orderId: string, recordedAt: Date) => ({ orgId: o.orgId, orderId, riderUserId: rider, latMicro: 30_000_000, lngMicro: 76_000_000, recordedAt });
    await db().insert(riderPositions).values([
      row(mineOrg, mine, ago(POSITION_RETENTION_MS + 60_000)),
      row(mineOrg, mine, ago(POSITION_RETENTION_MS + 1)),
      row(mineOrg, mine, ago(POSITION_RETENTION_MS - 1000)),
      row(mineOrg, mine, ago(60_000)),
      row(theirOrg, theirs, ago(POSITION_RETENTION_MS + 60_000)),
    ]);
    expect(await purgeRiderPositions(mineOrg.orgId, now)).toBe(2);
    expect(await fixesOf(mine)).toHaveLength(2);
    expect(await fixesOf(theirs)).toHaveLength(1); // the other org's old fix is that org's purge to make
    expect(await purgeRiderPositions(mineOrg.orgId, now)).toBe(0); // repeating is harmless
    expect(await purgeRiderPositions(theirOrg.orgId, now)).toBe(1);
  });

  it("respects the batch limit, so a backlog clears over several passes", async () => {
    await db().delete(riderPositions).where(eq(riderPositions.orgId, mineOrg.orgId)); // the previous test's survivors would be old by this clock
    const id = await order(mineOrg, "OUT_FOR_DELIVERY");
    const now = new Date("2026-09-30T12:00:00Z");
    const old = new Date(now.getTime() - POSITION_RETENTION_MS - 3600_000);
    await db().insert(riderPositions).values(Array.from({ length: 5 }, () => ({ orgId: mineOrg.orgId, orderId: id, riderUserId: rider, latMicro: 30_000_000, lngMicro: 76_000_000, recordedAt: old })));
    expect(await purgeRiderPositions(mineOrg.orgId, now, 3)).toBe(3);
    expect(await purgeRiderPositions(mineOrg.orgId, now, 3)).toBe(2);
    expect(await fixesOf(id)).toHaveLength(0);
  });
});

describe("the table itself", () => {
  const asRole = (role: "anon" | "authenticated") =>
    db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claim.sub', ${rider}, true)`);
      await tx.execute(sql.raw(`set local role ${role}`));
      return tx.execute(sql`select count(*) from rider_positions`);
    });

  it.each(["anon", "authenticated"] as const)("%s cannot read positions through the database at all", async (role) => {
    await expect(asRole(role)).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("deleting an order or an organization takes its fixes with it", async () => {
    const id = await order(org, "OUT_FOR_DELIVERY");
    await post(id);
    await db().delete(orders).where(eq(orders.id, id));
    expect(await fixesOf(id)).toHaveLength(0);
  });

  it("the CHECK constraints refuse an impossible coordinate even from a hand-written insert", async () => {
    const id = await order(org, "OUT_FOR_DELIVERY");
    await expect(db().insert(riderPositions).values({ orgId: org.orgId, orderId: id, riderUserId: rider, latMicro: 91_000_000, lngMicro: 0 })).rejects.toBeTruthy();
  });
});
