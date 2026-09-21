/**
 * Kitchen stations against a real database (roadmap 4.2): routing (override,
 * category, ASSEMBLY; combos by component; sauces to PACK), per-station scope
 * enforced server-side, idempotent marks that start the order exactly once, the
 * PACK step for takeaway and delivery, EXPO's READY gate, the DRINKS tab, and
 * org scoping.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, comboItems, kitchenLineStatus, kitchenOrderPack, orderEvents, orderItems, orders, products } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, createTestProduct, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { listProductStations, listVisibleStations, loadStationOrders, markOrderReadyFromExpo, setLineDone, setOrderPacked } from "./kitchen-stations";

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

/** A COMBO product in "Combos & Party Boxes" with the given components (none = a combo with no components defined). */
async function combo(owner: TestOrg, components: readonly string[], override: string | null = null): Promise<string> {
  const id = await product(owner, "Combos & Party Boxes", override);
  await db().update(products).set({ productType: "COMBO" }).where(eq(products.id, id));
  for (const [position, componentId] of components.entries()) await db().insert(comboItems).values({ comboProductId: id, productId: componentId, quantity: 1, position });
  return id;
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
const mark = (itemId: string, station: "FRY" | "ASSEMBLY" | "DRINKS" | "PACK", over: Partial<Parameters<typeof setLineDone>[0]> = {}) => setLineDone({ orgId: org.orgId, orderItemId: itemId, station, done: true, actorUserId: actor, ...over });
/** The order's station tasks as the boards see them. */
const tasksOf = async (orderId: string, owner: TestOrg = org) => (await loadStationOrders(owner.orgId)).find((x) => x.id === orderId)?.lines ?? [];
/** Mark every task except PACK's (PACK's are completed by "Packed"). */
const markAll = async (o: { id: string }) => {
  for (const task of await tasksOf(o.id)) if (task.station !== "PACK") await mark(task.id, task.station);
};

describe("loadStationOrders routing", () => {
  it("routes a line by override, then category, then ASSEMBLY, and sauces to PACK", async () => {
    const fries = await product(org, "Fries");
    const burger = await product(org, "Burgers");
    const overridden = await product(org, "Fries", "ASSEMBLY");
    const unknown = await product(org, "Brand New Category");
    const drink = await product(org, "Cold Drinks");
    const sauce = await product(org, "Sauces");
    const o = await order(org, [fries, burger, overridden, unknown, drink, sauce]);
    expect((await tasksOf(o.id)).map((l) => l.station)).toEqual(["FRY", "ASSEMBLY", "ASSEMBLY", "ASSEMBLY", "DRINKS", "PACK"]);
  });

  it("on a dine-in order sauces go to ASSEMBLY: there is no PACK step or screen for dine-in", async () => {
    const o = await order(org, [await product(org, "Sauces"), await product(org, "Fries", "PACK")], "ACCEPTED", "DINE_IN");
    expect((await tasksOf(o.id)).map((l) => l.station)).toEqual(["ASSEMBLY", "ASSEMBLY"]);
  });

  it("only returns orders in the kitchen, and never another org's", async () => {
    const pending = await order(org, [await product(org, "Fries")], "PENDING_PAYMENT");
    const theirs = await order(other, [await product(other, "Fries")]);
    const ids = (await loadStationOrders(org.orgId)).map((x) => x.id);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("lists the org's whole menu with each product's stations", async () => {
    const list = await listProductStations(other.orgId);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((row) => row.category === "Fries" && row.stations.join() === "FRY")).toBe(true);
  });
});

describe("combos", () => {
  it("are expanded into their components, each at its own station", async () => {
    const c = await combo(org, [await product(org, "Fries"), await product(org, "Burgers"), await product(org, "Sauces")]);
    const o = await order(org, [c]);
    expect((await tasksOf(o.id)).map((l) => l.station)).toEqual(["FRY", "ASSEMBLY", "PACK"]);
  });

  it("each station marks its own task; the order cannot go READY until every task is done", async () => {
    const c = await combo(org, [await product(org, "Fries"), await product(org, "Burgers")]);
    const o = await order(org, [c], "ACCEPTED", "DINE_IN");
    const item = o.itemIds[0]!;
    expect(await mark(item, "FRY")).toEqual({ ok: true });
    expect((await tasksOf(o.id)).map((t) => [t.station, t.done])).toEqual([["FRY", true], ["ASSEMBLY", false]]);
    expect(await markOrderReadyFromExpo({ orgId: org.orgId, orderId: o.id, actorUserId: actor })).toEqual({ ok: false, error: "1 line is not done yet." });
    expect(await mark(item, "ASSEMBLY")).toEqual({ ok: true });
    expect(await markOrderReadyFromExpo({ orgId: org.orgId, orderId: o.id, actorUserId: actor })).toEqual({ ok: true });
    expect(await status(o.id)).toBe("READY");
  });

  it("marking one station's task is idempotent and does not complete another's", async () => {
    const c = await combo(org, [await product(org, "Fries"), await product(org, "Burgers")]);
    const o = await order(org, [c]);
    await mark(o.itemIds[0]!, "FRY");
    await mark(o.itemIds[0]!, "FRY");
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(1);
    expect((await mark(o.itemIds[0]!, "DRINKS")).ok).toBe(false); // not one of this line's stations
  });

  it("with no components defined show on both FRY and ASSEMBLY, and both must mark", async () => {
    const o = await order(org, [await combo(org, [])], "ACCEPTED", "DINE_IN");
    expect((await tasksOf(o.id)).map((l) => l.station)).toEqual(["FRY", "ASSEMBLY"]);
    await mark(o.itemIds[0]!, "FRY");
    expect((await markOrderReadyFromExpo({ orgId: org.orgId, orderId: o.id, actorUserId: actor })).ok).toBe(false);
    await mark(o.itemIds[0]!, "ASSEMBLY");
    expect((await markOrderReadyFromExpo({ orgId: org.orgId, orderId: o.id, actorUserId: actor })).ok).toBe(true);
  });

  it("a component that is itself overridden goes where its override says", async () => {
    const c = await combo(org, [await product(org, "Fries", "DRINKS"), await product(org, "Burgers")]);
    const o = await order(org, [c]);
    expect((await tasksOf(o.id)).map((l) => l.station)).toEqual(["ASSEMBLY", "DRINKS"]);
  });

  it("a combo's own override sends it to that one station", async () => {
    const c = await combo(org, [await product(org, "Fries")], "ASSEMBLY");
    const o = await order(org, [c]);
    expect((await tasksOf(o.id)).map((l) => l.station)).toEqual(["ASSEMBLY"]);
  });

  it("ignore a component that belongs to another organization", async () => {
    const theirFries = await product(other, "Fries");
    const c = await combo(org, [theirFries]);
    const o = await order(org, [c]);
    // The only component is not ours, so it does not count: the combo has none, and shows on both.
    expect((await tasksOf(o.id)).map((l) => l.station)).toEqual(["FRY", "ASSEMBLY"]);
    expect((await listProductStations(org.orgId)).find((row) => row.source === "combo-components" && row.stations.join() === "FRY")).toBeUndefined();
  });
});

describe("setLineDone", () => {
  it("is idempotent: marking twice keeps one row, undoing twice is fine", async () => {
    const o = await order(org, [await product(org, "Fries")]);
    expect(await mark(o.itemIds[0]!, "FRY")).toEqual({ ok: true });
    expect(await mark(o.itemIds[0]!, "FRY")).toEqual({ ok: true });
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(1);
    expect(await mark(o.itemIds[0]!, "FRY", { done: false })).toEqual({ ok: true });
    expect(await mark(o.itemIds[0]!, "FRY", { done: false })).toEqual({ ok: true });
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(0);
  });

  it("a station may not touch another station's line", async () => {
    const o = await order(org, [await product(org, "Cold Drinks")]);
    expect((await mark(o.itemIds[0]!, "FRY")).ok).toBe(false);
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!))).toHaveLength(0);
    expect(await status(o.id)).toBe("ACCEPTED");
  });

  it("an unmapped line is ASSEMBLY's to mark, and only ASSEMBLY's", async () => {
    const o = await order(org, [await product(org, "Brand New Category")]);
    expect((await mark(o.itemIds[0]!, "FRY")).ok).toBe(false);
    expect(await mark(o.itemIds[0]!, "ASSEMBLY")).toEqual({ ok: true });
    const [row] = await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orderItemId, o.itemIds[0]!));
    expect(row?.station).toBe("ASSEMBLY");
    expect(row?.doneBy).toBe(actor);
  });

  it("refuses another org's line, and an order no longer in the kitchen", async () => {
    const theirs = await order(other, [await product(other, "Fries")]);
    expect((await mark(theirs.itemIds[0]!, "FRY")).ok).toBe(false);
    for (const closed of ["PENDING_PAYMENT", "CANCELLED"] as const) {
      const o = await order(org, [await product(org, "Fries")], closed);
      expect((await mark(o.itemIds[0]!, "FRY")).ok, closed).toBe(false);
      expect(await status(o.id)).toBe(closed);
    }
    expect(await db().select().from(kitchenLineStatus).where(eq(kitchenLineStatus.orgId, other.orgId))).toHaveLength(0);
  });

  it("a line already marked stays done when its product's station changes mid-service", async () => {
    const productId = await product(org, "Fries");
    const o = await order(org, [productId]);
    await mark(o.itemIds[0]!, "FRY");
    await db().update(products).set({ kdsStation: "ASSEMBLY" }).where(eq(products.id, productId));
    expect((await tasksOf(o.id)).map((t) => [t.station, t.done])).toEqual([["ASSEMBLY", true]]);
  });
});

describe("marking a line starts the order", () => {
  it("moves ACCEPTED to PREPARING with one order event by the marking user, however many marks", async () => {
    const o = await order(org, [await product(org, "Fries"), await product(org, "Burgers")]);
    await mark(o.itemIds[0]!, "FRY");
    await mark(o.itemIds[0]!, "FRY");
    await mark(o.itemIds[1]!, "ASSEMBLY");
    await mark(o.itemIds[1]!, "ASSEMBLY");
    expect(await status(o.id)).toBe("PREPARING");
    const events = await startEvents(o.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.actorUserId).toBe(actor);
  });

  it("does nothing to an order that is already PREPARING", async () => {
    const o = await order(org, [await product(org, "Fries")], "PREPARING");
    await mark(o.itemIds[0]!, "FRY");
    expect(await status(o.id)).toBe("PREPARING");
    expect(await startEvents(o.id)).toHaveLength(0);
  });

  it("a concurrent double tap still makes exactly one event", async () => {
    const o = await order(org, [await product(org, "Fries")]);
    const results = await Promise.all([mark(o.itemIds[0]!, "FRY"), mark(o.itemIds[0]!, "FRY"), mark(o.itemIds[0]!, "FRY")]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await startEvents(o.id)).toHaveLength(1);
    expect(await status(o.id)).toBe("PREPARING");
  });

  it("undoing a line does not move the order back", async () => {
    const o = await order(org, [await product(org, "Fries")]);
    await mark(o.itemIds[0]!, "FRY");
    await mark(o.itemIds[0]!, "FRY", { done: false });
    expect(await status(o.id)).toBe("PREPARING");
    expect(await startEvents(o.id)).toHaveLength(1);
  });

  it("never moves an order that is not ACCEPTED or PREPARING", async () => {
    const o = await order(org, [await product(org, "Fries")], "CANCELLED");
    await mark(o.itemIds[0]!, "FRY");
    expect(await status(o.id)).toBe("CANCELLED");
    expect(await db().select().from(orderEvents).where(eq(orderEvents.orderId, o.id))).toHaveLength(0);
  });
});

describe("PACK", () => {
  const pack = (orderId: string, packed = true) => setOrderPacked({ orgId: org.orgId, orderId, packed, actorUserId: actor });

  it("is refused while any other station's task is open, and names how many", async () => {
    const o = await order(org, [await product(org, "Fries"), await product(org, "Cold Drinks")]);
    await mark(o.itemIds[0]!, "FRY");
    expect(await pack(o.id)).toEqual({ ok: false, error: "1 line is not done yet." });
    expect(await db().select().from(kitchenOrderPack).where(eq(kitchenOrderPack.orderId, o.id))).toHaveLength(0);
  });

  it("is refused for dine-in", async () => {
    const o = await order(org, [await product(org, "Fries")], "ACCEPTED", "DINE_IN");
    await markAll(o);
    expect((await pack(o.id)).ok).toBe(false);
    expect(await db().select().from(kitchenOrderPack).where(eq(kitchenOrderPack.orderId, o.id))).toHaveLength(0);
  });

  it("'Packed' completes the sauce lines and the order step together, idempotently, and undoes both", async () => {
    for (const fulfilment of ["TAKEAWAY", "DELIVERY"] as const) {
      const o = await order(org, [await product(org, "Fries"), await product(org, "Sauces"), await product(org, "Sauces")], "ACCEPTED", fulfilment);
      await markAll(o);
      expect((await tasksOf(o.id)).filter((t) => t.station === "PACK").every((t) => !t.done)).toBe(true);
      expect(await pack(o.id)).toEqual({ ok: true });
      expect(await pack(o.id)).toEqual({ ok: true });
      const rows = await db().select().from(kitchenOrderPack).where(eq(kitchenOrderPack.orderId, o.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.packedBy).toBe(actor);
      expect((await db().select().from(kitchenLineStatus).where(and(eq(kitchenLineStatus.orderId, o.id), eq(kitchenLineStatus.station, "PACK")))).length).toBe(2);
      const after = (await loadStationOrders(org.orgId)).find((x) => x.id === o.id);
      expect(after?.packed).toBe(true);
      expect(after?.lines.every((t) => t.done)).toBe(true);
      expect(await pack(o.id, false)).toEqual({ ok: true });
      expect(await pack(o.id, false)).toEqual({ ok: true });
      expect(await db().select().from(kitchenOrderPack).where(eq(kitchenOrderPack.orderId, o.id))).toHaveLength(0);
      expect((await tasksOf(o.id)).filter((t) => t.station === "PACK").every((t) => !t.done)).toBe(true);
    }
  });

  it("refuses another org's order and one no longer in the kitchen", async () => {
    const theirs = await order(other, [await product(other, "Fries")]);
    expect((await pack(theirs.id)).ok).toBe(false);
    const closed = await order(org, [await product(org, "Fries")], "CANCELLED");
    expect((await pack(closed.id)).ok).toBe(false);
  });
});

describe("markOrderReadyFromExpo", () => {
  const ready = (orderId: string) => markOrderReadyFromExpo({ orgId: org.orgId, orderId, actorUserId: actor });

  it("refuses while any line is open, and names how many", async () => {
    const o = await order(org, [await product(org, "Fries"), await product(org, "Cold Drinks")], "ACCEPTED", "DINE_IN");
    await mark(o.itemIds[0]!, "FRY");
    expect(await ready(o.id)).toEqual({ ok: false, error: "1 line is not done yet." });
    expect(await status(o.id)).toBe("PREPARING");
  });

  it("a dine-in order goes READY once every task is done, with no PACK step", async () => {
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

  it("with sauces, is refused until 'Packed' has completed the sauce lines", async () => {
    const o = await order(org, [await product(org, "Fries"), await product(org, "Sauces")], "ACCEPTED", "TAKEAWAY");
    await markAll(o);
    expect((await ready(o.id)).ok).toBe(false);
    await setOrderPacked({ orgId: org.orgId, orderId: o.id, packed: true, actorUserId: actor });
    expect(await ready(o.id)).toEqual({ ok: true });
  });

  it("will not touch another org's order", async () => {
    const theirs = await order(other, [await product(other, "Fries")], "ACCEPTED", "DINE_IN");
    await setLineDone({ orgId: other.orgId, orderItemId: theirs.itemIds[0]!, station: "FRY", done: true, actorUserId: actor });
    expect((await ready(theirs.id)).ok).toBe(false);
  });
});

describe("the DRINKS tab", () => {
  it("is hidden while no product in the org resolves to DRINKS, and appears once one does", async () => {
    const tiny = await createTestOrg();
    try {
      await product(tiny, "Fries");
      await product(tiny, "Burgers");
      expect(await listVisibleStations(tiny.orgId)).toEqual(["FRY", "ASSEMBLY", "PACK"]);
      const drink = await product(tiny, "Cold Drinks");
      expect(await listVisibleStations(tiny.orgId)).toEqual(["FRY", "ASSEMBLY", "DRINKS", "PACK"]);
      // Via an override on any product too, and via a combo component.
      await db().update(products).set({ isActive: false }).where(eq(products.id, drink));
      expect(await listVisibleStations(tiny.orgId)).toEqual(["FRY", "ASSEMBLY", "PACK"]);
      await product(tiny, "Burgers", "DRINKS");
      expect(await listVisibleStations(tiny.orgId)).toContain("DRINKS");
    } finally {
      await deleteTestOrg(tiny.orgId);
    }
  });

  it("stays visible while an order in the kitchen still has a drinks task, so it can be marked", async () => {
    const tiny = await createTestOrg();
    try {
      const drink = await product(tiny, "Cold Drinks");
      await order(tiny, [drink]);
      await db().update(products).set({ isActive: false }).where(eq(products.id, drink));
      expect(await listVisibleStations(tiny.orgId)).toContain("DRINKS");
    } finally {
      await deleteTestOrg(tiny.orgId);
    }
  });

  it("still routes correctly while hidden", async () => {
    const o = await order(org, [await product(org, "Cold Drinks")]);
    expect((await tasksOf(o.id)).map((t) => t.station)).toEqual(["DRINKS"]);
  });
});
