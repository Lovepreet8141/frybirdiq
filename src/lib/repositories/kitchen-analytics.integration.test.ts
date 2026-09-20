/**
 * Kitchen analytics against a real database (roadmap 4.4): the window is by
 * READY time, samples come from order_events only, and nothing of another
 * org's leaks in.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderEvents, orderItems, orders, products } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestOrg, createTestProduct, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { getKitchenAnalytics } from "./kitchen-analytics";

const RANGE = { from: new Date("2026-09-14T18:30:00Z"), to: new Date("2026-09-15T18:30:00Z"), label: "Tuesday" }; // IST 15 Sep
let org: TestOrg;
let other: TestOrg;

beforeAll(async () => {
  org = await createTestOrg();
  other = await createTestOrg();
});
afterAll(async () => {
  await deleteTestOrg(org.orgId);
  await deleteTestOrg(other.orgId);
});

async function product(owner: TestOrg, name: string, prep: number | null): Promise<string> {
  const p = await createTestProduct(owner.orgId, { name });
  await db().update(products).set({ prepMinutes: prep }).where(eq(products.id, p.id));
  return p.id;
}

async function served(owner: TestOrg, productIds: readonly string[], acceptedIso: string, readyIso: string | null): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({ orgId: owner.orgId, locationId: owner.locationId, orderNumber: `A-${randomUUID().slice(0, 6)}`, businessDate: "2026-09-15", status: "READY", channel: "ONLINE", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100") })
    .returning({ id: orders.id });
  for (const [position, productId] of productIds.entries()) {
    await db().insert(orderItems).values({ orgId: owner.orgId, orderId: row!.id, productId, productName: `Line ${position}`, quantity: 1, unitPrice: fromRupees("100"), lineSubtotal: fromRupees("100"), lineTotal: fromRupees("100"), position });
  }
  await db().insert(orderEvents).values({ orgId: owner.orgId, orderId: row!.id, fromStatus: "PAID", toStatus: "ACCEPTED", createdAt: new Date(acceptedIso) });
  if (readyIso) await db().insert(orderEvents).values({ orgId: owner.orgId, orderId: row!.id, fromStatus: "PREPARING", toStatus: "READY", createdAt: new Date(readyIso) });
  return row!.id;
}

describe("getKitchenAnalytics", () => {
  it("is no data, not zero, when nothing was readied in the window", async () => {
    const result = await getKitchenAnalytics(org.orgId, RANGE);
    expect(result.overall).toBeNull();
    expect(result.products).toEqual([]);
    expect(result.hours).toEqual([]);
  });

  it("measures ACCEPTED to READY per order and per product, and carries the configured target", async () => {
    const slow = await product(org, "Slow Burger", 8);
    const quick = await product(org, "Quick Fries", null);
    await served(org, [slow, quick], "2026-09-15T06:00:00Z", "2026-09-15T06:10:00Z"); // 600s, 11:30 IST
    await served(org, [quick], "2026-09-15T06:00:00Z", "2026-09-15T06:04:00Z"); // 240s
    await served(org, [quick], "2026-09-15T07:00:00Z", null); // never READY: not a sample

    const result = await getKitchenAnalytics(org.orgId, RANGE);
    expect(result.overall).toEqual({ count: 2, p50: 240, p90: 600, mean: 420 });
    const slowRow = result.products.find((p) => p.productKey === slow);
    expect(slowRow?.summary.p50).toBe(600);
    expect(slowRow?.targetMinutes).toBe(8);
    expect(result.products.find((p) => p.productKey === quick)?.summary.count).toBe(2);
    expect(result.hours.map((h) => h.hour)).toEqual([11]);
  });

  it("counts an order on the day it was readied, even if accepted the day before", async () => {
    const before = await getKitchenAnalytics(org.orgId, RANGE);
    await served(org, [await product(org, "Midnight", null)], "2026-09-14T18:20:00Z", "2026-09-14T18:40:00Z"); // accepted 23:50 IST 14th, ready 00:10 IST 15th
    const after = await getKitchenAnalytics(org.orgId, RANGE);
    expect(after.overall!.count).toBe(before.overall!.count + 1);
  });

  it("does not count an order readied outside the window", async () => {
    const before = await getKitchenAnalytics(org.orgId, RANGE);
    await served(org, [await product(org, "Next day", null)], "2026-09-15T18:00:00Z", "2026-09-15T18:40:00Z");
    expect((await getKitchenAnalytics(org.orgId, RANGE)).overall!.count).toBe(before.overall!.count);
  });

  it("never includes another organization's orders", async () => {
    const before = await getKitchenAnalytics(org.orgId, RANGE);
    await served(other, [await product(other, "Theirs", 1)], "2026-09-15T06:00:00Z", "2026-09-15T07:00:00Z");
    const after = await getKitchenAnalytics(org.orgId, RANGE);
    expect(after.overall).toEqual(before.overall);
    expect(after.products.some((p) => p.productName === "Line 0" && p.summary.p50 === 3600)).toBe(false);
    expect((await getKitchenAnalytics(other.orgId, RANGE)).overall?.count).toBe(1);
  });
});
