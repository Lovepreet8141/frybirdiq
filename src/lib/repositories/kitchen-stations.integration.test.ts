/**
 * Kitchen stations against a real database (roadmap 4.2): routing (override,
 * then category, then ASSEMBLY), per-station scope enforced server-side,
 * idempotent line marks that start the order exactly once, the PACK step for
 * takeaway and delivery, EXPO's READY gate, and org scoping.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, kitchenLineStatus, kitchenOrderPack, orderEvents, orderItems, orders, products } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, createTestProduct, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { listProductStations, loadStationOrders, markOrderReadyFromExpo, setLineDone, setOrderPacked } from "./kitchen-stations";

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

/** A product in a category of the given name, with an optional per-product override. */
async function product(owner: TestOrg, category: string, override: string | null = null): Promise<string> {
  const p = await createTestProduct(owner.orgId);
  const [row] = await db().select({ categoryId: products.categoryId }).from(products).where(eq(products.id, p.id));
  await db().update(categories).set({ name: category }).where(eq(categories.id, row!.categoryId!));
  await db().update(products).set({ kdsStation: override }).where(eq(products.id, p.id));
  return p.id;
}

type Status = "ACCEPTED" | "PREPARING" | "PENDING_PAYMENT" | "CANCELLED";
type Fulfilment = "DINE_IN" | "TAKEAWAY" | "DELIVERY";

async function order(owner: TestOrg, productIds: readonly string[], status: Status = "ACCEPTED", fulfilment: Fulfilment = "TAKEAWAY"): Promise<{ id: string; itemIds: string[] }> {
  const [row] = await db()
    .insert(orders)
    .values({ orgId: owner.orgId, locationId: owner.locationId, orderNumber: `S-${randomUUID().slice(0, 6)}`, businessDate: "2026-09-21", status, channel: fulfilment === "DINE_IN" ? "DINE_IN" : "ONLINE", fulfilment, grandTotal: fromRupees("100"), placedAt: new Date() })
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
const startEvents = (orderId: string) => db().select().from(orderEvents).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.fromStatus, "ACCEPTED"), eq(orderEvents.toStatus, "PREPARING")));
const mark = (itemId: string, over: Partial<Parameters<typeof setLineDone>[0]> = {}) => setLineDone({ orgId: org.orgId, orderItemId: itemId, done: true, actorUserId: actor, ...over });
const markAll = async (o: { itemIds: string[] }) => {
  for (const id of o.itemIds) await mark(id);
};

describe("loadStationOrders routing", () => {
  it("routes a line by override, then category, then ASSEMBLY", async () => {
    const fries = await product(org, "Fries");
    const burger = await product(org, "Burgers");
    const overridden = await product(org, "Fries", "ASSEMBLY");
    const unknown = await product(org, "Brand New Category");
    const drink = await product(org, "Cold Drinks");
    const o = await order(org, [fries, burger, overridden, unknown, drink]);
    const loaded = (await loadStationOrders(org.orgId)).find((x) => x.id === o.id);
    expect(loaded?.lines.map((l) => l.station)).toEqual(["FRY", "ASSEMBLY", "ASSEMBLY", "ASSEMBLY", "DRINKS"]);
  });

  it("only returns orders in the kitchen, and never another org's", async () => {
    const pending = await order(org, [await product(org, "Fries")], "PENDING_PAYMENT");
    const theirs = await order(other, [await product(other, "Fries")]);
    const ids = (await loadStationOrders(org.orgId)).map((x) => x.id);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("lists the org's whole menu with each product's station", async () => {
    const list = await listProductStations(other.orgId);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((row) => ["FRY", "ASSEMBLY", "DRINKS"].includes(row.station))).toBe(true);
    expect(list.some((row) => row.category === "Fries" && row.station === "FRY")).toBe(true);
  });
});

describe("setLineDone", () => {
  it("is idempotent: marking twice keeps one row, undoing twice is fine", async () => {
    const o = await order(org, [await product(org, "Fries")]);
    expect(await mark(o.itemIds[0]!, { onlyStation: "FRY" })).toEqual({ ok: true });
    expect(await mark(o.itemIds[0]!, { onlyStation: "FRY" })).toEqual({ ok: true });
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(1);
    expect(await mark(o.itemIds[0]!, { done: false })).toEqual({ ok: true });
    expect(await mark(o.itemIds[0]!, { done: false })).toEqual({ ok: true });
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(0);
  });

  it("a station may not touch another station's line", async () => {
    const o = await order(org, [await product(org, "Cold Drinks")]);
    expect((await mark(o.itemIds[0]!, { onlyStation: "FRY" })).ok).toBe(false);
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(0);
    expect(await status(o.id)).toBe("ACCEPTED");
  });

  it("an unmapped line is ASSEMBLY's to mark, and only ASSEMBLY's", async () => {
    const o = await order(org, [await product(org, "Sauces")]);
    expect((await mark(o.itemIds[0]!, { onlyStation: "FRY" })).ok).toBe(false);
    expect(await mark(o.itemIds[0]!, { onlyStation: "ASSEMBLY" })).toEqual({ ok: true });
    const [row] = await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!));
    expect(row?.station).toBe("ASSEMBLY");
    expect(row?.doneBy).toBe(actor);
  });

  it("refuses another org's line, and an order no longer in the kitchen", async () => {
    const theirs = await order(other, [await product(other, "Fries")]);
    expect((await mark(theirs.itemIds[0]!)).ok).toBe(false);
    for (const closed of ["PENDING_PAYMENT", "CANCELLED"] as const) {
      const o = await order(org, [await product(org, "Fries")], closed);
      expect((await mark(o.itemIds[0]!)).ok, closed).toBe(false);
      expect(await status(o.id)).toBe(closed);
    }
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orgId, other.orgId))).toHaveLength(0);
  });
});

describe("marking a line starts the order", () => {
  it("moves ACCEPTED to PREPARING with one order event by the marking user, however many marks", async () => {
    const o = await order(org, [await product(org, "Fries"), await product(org, "Burgers")]);
    await mark(o.itemIds[0]!);
    await mark(o.itemIds[0]!);
    await mark(o.itemIds[1]!);
    await mark(o.itemIds[1]!);
    expect(await status(o.id)).toBe("PREPARING");
    const events = await startEvents(o.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.actorUserId).toBe(actor);
  });

  it("does nothing to an order that is already PREPARING", async () => {
    const o = await order(org, [await product(org, "Fries")], "PREPARING");
    await mark(o.itemIds[0]!);
    expect(await status(o.id)).toBe("PREPARING");
    expect(await startEvents(o.id)).toHaveLength(0);
  });

  it("a concurrent double tap still makes exactly one event", async () => {
    const o = await order(org, [await product(org, "Fries")]);
    const results = await Promise.all([mark(o.itemIds[0]!), mark(o.itemIds[0]!), mark(o.itemIds[0]!)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await startEvents(o.id)).toHaveLength(1);
    expect(await status(o.id)).toBe("PREPARING");
  });

  it("undoing a line does not move the order back", async () => {
    const o = await order(org, [await product(org, "Fries")]);
    await mark(o.itemIds[0]!);
    await mark(o.itemIds[0]!, { done: false });
    expect(await status(o.id)).toBe("PREPARING");
    expect(await startEvents(o.id)).toHaveLength(1);
  });

  it("never moves an order that is not ACCEPTED or PREPARING", async () => {
    const o = await order(org, [await product(org, "Fries")], "CANCELLED");
    await mark(o.itemIds[0]!);
    expect(await status(o.id)).toBe("CANCELLED");
    expect(await db().select().from(orderEvents).where(eq(orderEvents.orderId, o.id))).toHaveLength(0);
  });
});

describe("PACK", () => {
  it("is refused while any line is open, and names how many", async () => {
    const o = await order(org, [await product(org, "Fries"), await product(org, "Cold Drinks")]);
    await mark(o.itemIds[0]!);
    expect(await setOrderPacked({ orgId: org.orgId, orderId: o.id, packed: true, actorUserId: actor })).toEqual({ ok: false, error: "1 line is not done yet." });
    expect(await db().select().from(kitchenOrderPack).where(eq(kitchenOrderPack.orderId, o.id))).toHaveLength(0);
  });

  it("is refused for dine-in", async () => {
    const o = await order(org, [await product(org, "Fries")], "ACCEPTED", "DINE_IN");
    await markAll(o);
    const result = await setOrderPacked({ orgId: org.orgId, orderId: o.id, packed: true, actorUserId: actor });
    expect(result.ok).toBe(false);
    expect(await db().select().from(kitchenOrderPack).where(eq(kitchenOrderPack.orderId, o.id))).toHaveLength(0);
  });

  it("is idempotent and undoable, for takeaway and delivery", async () => {
    for (const fulfilment of ["TAKEAWAY", "DELIVERY"] as const) {
      const o = await order(org, [await product(org, "Fries")], "ACCEPTED", fulfilment);
      await markAll(o);
      const args = { orgId: org.orgId, orderId: o.id, actorUserId: actor };
      expect(await setOrderPacked({ ...args, packed: true })).toEqual({ ok: true });
      expect(await setOrderPacked({ ...args, packed: true })).toEqual({ ok: true });
      const rows = await db().select().from(kitchenOrderPack).where(eq(kitchenOrderPack.orderId, o.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.packedBy).toBe(actor);
      expect((await loadStationOrders(org.orgId)).find((x) => x.id === o.id)?.packed).toBe(true);
      expect(await setOrderPacked({ ...args, packed: false })).toEqual({ ok: true });
      expect(await setOrderPacked({ ...args, packed: false })).toEqual({ ok: true });
      expect(await db().select().from(kitchenOrderPack).where(eq(kitchenOrderPack.orderId, o.id))).toHaveLength(0);
    }
  });

  it("refuses another org's order and one no longer in the kitchen", async () => {
    const theirs = await order(other, [await product(other, "Fries")]);
    expect((await setOrderPacked({ orgId: org.orgId, orderId: theirs.id, packed: true, actorUserId: actor })).ok).toBe(false);
    const closed = await order(org, [await product(org, "Fries")], "CANCELLED");
    expect((await setOrderPacked({ orgId: org.orgId, orderId: closed.id, packed: true, actorUserId: actor })).ok).toBe(false);
  });
});

describe("markOrderReadyFromExpo", () => {
  const ready = (orderId: string) => markOrderReadyFromExpo({ orgId: org.orgId, orderId, actorUserId: actor });

  it("refuses while any line is open, and names how many", async () => {
    const o = await order(org, [await product(org, "Fries"), await product(org, "Cold Drinks")], "ACCEPTED", "DINE_IN");
    await mark(o.itemIds[0]!);
    expect(await ready(o.id)).toEqual({ ok: false, error: "1 line is not done yet." });
    expect(await status(o.id)).toBe("PREPARING");
  });

  it("a dine-in order goes READY once every line is done, with no PACK step", async () => {
    const o = await order(org, [await product(org, "Fries"), await product(org, "Sauces")], "ACCEPTED", "DINE_IN");
    await markAll(o);
    expect(await ready(o.id)).toEqual({ ok: true });
    expect(await status(o.id)).toBe("READY");
    expect(await ready(o.id)).toEqual({ ok: true });
  });

  it("a takeaway or delivery order is refused until PACK is done, then goes READY, and a retry is a no-op", async () => {
    for (const fulfilment of ["TAKEAWAY", "DELIVERY"] as const) {
      const o = await order(org, [await product(org, "Fries"), await product(org, "Cold Drinks")], "ACCEPTED", fulfilment);
      await markAll(o);
      expect(await ready(o.id)).toEqual({ ok: false, error: "This order has to be packed first." });
      expect(await status(o.id)).toBe("PREPARING");
      await setOrderPacked({ orgId: org.orgId, orderId: o.id, packed: true, actorUserId: actor });
      expect(await ready(o.id)).toEqual({ ok: true });
      expect(await ready(o.id)).toEqual({ ok: true });
      expect(await status(o.id)).toBe("READY");
    }
  });

  it("will not touch another org's order", async () => {
    const theirs = await order(other, [await product(other, "Fries")], "ACCEPTED", "DINE_IN");
    await setLineDone({ orgId: other.orgId, orderItemId: theirs.itemIds[0]!, done: true, actorUserId: actor });
    expect((await ready(theirs.id)).ok).toBe(false);
  });
});
