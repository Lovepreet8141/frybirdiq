/**
 * Kitchen stations against a real database (roadmap 4.2): routing from the
 * product's station, per-station scope enforced server-side, idempotent line
 * marks, EXPO's READY gate, and org scoping.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { kitchenLineStatus, orderItems, orders, products } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, createTestProduct, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { loadStationOrders, markOrderReadyFromExpo, setLineDone } from "./kitchen-stations";

let org: TestOrg;
let other: TestOrg;
const actor = randomUUID();

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

async function product(owner: TestOrg, station: string | null): Promise<string> {
  const p = await createTestProduct(owner.orgId);
  await db().update(products).set({ kdsStation: station }).where(eq(products.id, p.id));
  return p.id;
}

async function order(owner: TestOrg, productIds: readonly string[], status: "ACCEPTED" | "PREPARING" | "PENDING_PAYMENT" = "ACCEPTED"): Promise<{ id: string; itemIds: string[] }> {
  const [row] = await db()
    .insert(orders)
    .values({ orgId: owner.orgId, locationId: owner.locationId, orderNumber: `S-${randomUUID().slice(0, 6)}`, businessDate: "2026-09-21", status, channel: "ONLINE", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100"), placedAt: new Date() })
    .returning({ id: orders.id });
  const itemIds: string[] = [];
  for (const [position, productId] of productIds.entries()) {
    const [item] = await db()
      .insert(orderItems)
      .values({ orgId: owner.orgId, orderId: row!.id, productId, productName: `Item ${position}`, quantity: 1, unitPrice: fromRupees("100"), lineSubtotal: fromRupees("100"), lineTotal: fromRupees("100"), position })
      .returning({ id: orderItems.id });
    itemIds.push(item!.id);
  }
  return { id: row!.id, itemIds };
}

const status = async (id: string) => (await db().select({ s: orders.status }).from(orders).where(eq(orders.id, id)))[0]?.s;

describe("loadStationOrders", () => {
  it("routes each line by its product's station, and unset is UNASSIGNED", async () => {
    const [fry, none, legacy] = [await product(org, "FRY"), await product(org, null), await product(org, "grill")];
    const o = await order(org, [fry, none, legacy]);
    const loaded = (await loadStationOrders(org.orgId)).find((x) => x.id === o.id);
    expect(loaded?.lines.map((l) => l.station)).toEqual(["FRY", "UNASSIGNED", "UNASSIGNED"]);
    expect(loaded?.lines.every((l) => !l.done)).toBe(true);
  });

  it("only returns orders in the kitchen, and never another org's", async () => {
    const pending = await order(org, [await product(org, "FRY")], "PENDING_PAYMENT");
    const theirs = await order(other, [await product(other, "FRY")]);
    const ids = (await loadStationOrders(org.orgId)).map((x) => x.id);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(theirs.id);
  });
});

describe("setLineDone", () => {
  it("is idempotent: marking twice keeps one row, undoing twice is fine", async () => {
    const o = await order(org, [await product(org, "FRY")]);
    const args = { orgId: org.orgId, orderItemId: o.itemIds[0]!, actorUserId: actor };
    expect(await setLineDone({ ...args, done: true, onlyStation: "FRY" })).toEqual({ ok: true });
    expect(await setLineDone({ ...args, done: true, onlyStation: "FRY" })).toEqual({ ok: true });
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(1);
    expect(await setLineDone({ ...args, done: false })).toEqual({ ok: true });
    expect(await setLineDone({ ...args, done: false })).toEqual({ ok: true });
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(0);
  });

  it("a station may not touch another station's line", async () => {
    const o = await order(org, [await product(org, "DRINKS")]);
    const result = await setLineDone({ orgId: org.orgId, orderItemId: o.itemIds[0]!, done: true, actorUserId: actor, onlyStation: "FRY" });
    expect(result.ok).toBe(false);
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(0);
  });

  it("EXPO (no station) can clear an unassigned line", async () => {
    const o = await order(org, [await product(org, null)]);
    expect(await setLineDone({ orgId: org.orgId, orderItemId: o.itemIds[0]!, done: true, actorUserId: actor })).toEqual({ ok: true });
    const [row] = await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!));
    expect(row?.station).toBe("UNASSIGNED");
    expect(row?.doneBy).toBe(actor);
  });

  it("refuses another org's line, and an order no longer in the kitchen", async () => {
    const theirs = await order(other, [await product(other, "FRY")]);
    expect((await setLineDone({ orgId: org.orgId, orderItemId: theirs.itemIds[0]!, done: true, actorUserId: actor })).ok).toBe(false);
    const pending = await order(org, [await product(org, "FRY")], "PENDING_PAYMENT");
    expect((await setLineDone({ orgId: org.orgId, orderItemId: pending.itemIds[0]!, done: true, actorUserId: actor })).ok).toBe(false);
    expect(await db().select().from(kitchenLineStatus).where(and(eq(kitchenLineStatus.orgId, other.orgId)))).toHaveLength(0);
  });
});

describe("markOrderReadyFromExpo", () => {
  it("refuses while any line is open, and names how many", async () => {
    const o = await order(org, [await product(org, "FRY"), await product(org, "DRINKS")]);
    await setLineDone({ orgId: org.orgId, orderItemId: o.itemIds[0]!, done: true, actorUserId: actor });
    const result = await markOrderReadyFromExpo({ orgId: org.orgId, orderId: o.id, actorUserId: actor });
    expect(result).toEqual({ ok: false, error: "1 line is not done yet." });
    expect(await status(o.id)).toBe("ACCEPTED");
  });

  it("an unassigned line blocks it until EXPO marks it", async () => {
    const o = await order(org, [await product(org, "FRY"), await product(org, null)]);
    await setLineDone({ orgId: org.orgId, orderItemId: o.itemIds[0]!, done: true, actorUserId: actor });
    expect((await markOrderReadyFromExpo({ orgId: org.orgId, orderId: o.id, actorUserId: actor })).ok).toBe(false);
    await setLineDone({ orgId: org.orgId, orderItemId: o.itemIds[1]!, done: true, actorUserId: actor });
    expect((await markOrderReadyFromExpo({ orgId: org.orgId, orderId: o.id, actorUserId: actor })).ok).toBe(true);
    expect(await status(o.id)).toBe("READY");
  });

  it("goes READY once every line is done, from ACCEPTED or PREPARING, and a retry is a no-op", async () => {
    for (const start of ["ACCEPTED", "PREPARING"] as const) {
      const o = await order(org, [await product(org, "FRY"), await product(org, "PACK")], start);
      for (const id of o.itemIds) await setLineDone({ orgId: org.orgId, orderItemId: id, done: true, actorUserId: actor });
      const args = { orgId: org.orgId, orderId: o.id, actorUserId: actor };
      expect(await markOrderReadyFromExpo(args)).toEqual({ ok: true });
      expect(await markOrderReadyFromExpo(args)).toEqual({ ok: true });
      expect(await status(o.id)).toBe("READY");
    }
  });

  it("will not touch another org's order", async () => {
    const theirs = await order(other, [await product(other, "FRY")]);
    await setLineDone({ orgId: other.orgId, orderItemId: theirs.itemIds[0]!, done: true, actorUserId: actor });
    expect((await markOrderReadyFromExpo({ orgId: org.orgId, orderId: theirs.id, actorUserId: actor })).ok).toBe(false);
    expect(await status(theirs.id)).toBe("ACCEPTED");
  });
});
