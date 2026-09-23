/**
 * IQ READINESS counts against a real database. Now = Monday 2026-09-21 12:00 IST,
 * so the current window is 2026-09-14..09-20 and the previous one 09-07..09-13
 * (today is left out). Every figure is seeded by hand and counted back.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { inventoryItems, inventoryMovements, orderEvents, orderItems, orders, organizations, payments, recipes } from "@/db/schema";
import { fromRupees } from "@/lib/money";
import { createTestCustomer, createTestIngredient, createTestOrg, createTestProduct, createTestRecipe, createTestTaxRate, deleteTestOrg, type TestOrg } from "./__test-support__/fixtures";
import { getReadiness, getReadinessRaw, readinessWindows } from "./iq-readiness";
import { eq } from "drizzle-orm";

const NOW = new Date("2026-09-21T12:00:00+05:30");
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

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

type Status = "DRAFT" | "PENDING_PAYMENT" | "PAID" | "ACCEPTED" | "COMPLETED" | "CANCELLED" | "FAILED";
async function order(owner: TestOrg, date: string, status: Status, opts: { customerId?: string; events?: { to: Status; at: Date }[]; cash?: "CAPTURED" | "PENDING" | "REFUNDED"; items?: { productId: string; name: string; qty: number }[] } = {}): Promise<string> {
  const [row] = await db()
    .insert(orders)
    .values({ orgId: owner.orgId, locationId: owner.locationId, orderNumber: `R-${randomUUID().slice(0, 8)}`, businessDate: date, status, channel: "TAKEAWAY", fulfilment: "TAKEAWAY", grandTotal: fromRupees("100"), customerId: opts.customerId })
    .returning({ id: orders.id });
  const id = row!.id;
  for (const e of opts.events ?? []) await db().insert(orderEvents).values({ orgId: owner.orgId, orderId: id, toStatus: e.to, createdAt: e.at });
  if (opts.cash) await db().insert(payments).values({ orgId: owner.orgId, orderId: id, status: opts.cash, method: "CASH", amount: fromRupees("100"), provider: "cash" });
  for (const item of opts.items ?? []) {
    await db().insert(orderItems).values({ orgId: owner.orgId, orderId: id, productId: item.productId, productName: item.name, quantity: item.qty, unitPrice: fromRupees("100"), lineSubtotal: fromRupees("100"), lineTotal: fromRupees("100") });
  }
  return id;
}

describe("windows", () => {
  it("the last 7 finished days and the 7 before, today excluded", () => {
    expect(readinessWindows(NOW)).toEqual({ current: { from: "2026-09-14", to: "2026-09-20" }, previous: { from: "2026-09-07", to: "2026-09-13" } });
  });
});

describe("orders closed the same day", () => {
  it("counts an order closed before its own day ended, not one closed the next morning, not one still open; ignores drafts, today and other orgs", async () => {
    await order(org, "2026-09-16", "COMPLETED", { events: [{ to: "COMPLETED", at: ist("2026-09-16", "21:00") }] }); // same day
    await order(org, "2026-09-16", "CANCELLED", { events: [{ to: "CANCELLED", at: ist("2026-09-16", "23:59") }] }); // same day, cancelled counts as closed
    await order(org, "2026-09-17", "COMPLETED", { events: [{ to: "COMPLETED", at: ist("2026-09-18", "00:05") }] }); // closed after midnight
    await order(org, "2026-09-17", "ACCEPTED"); // never closed
    await order(org, "2026-09-18", "DRAFT"); // a draft is not an order
    await order(org, "2026-09-21", "ACCEPTED"); // today, outside the window
    await order(org, "2026-09-10", "COMPLETED", { events: [{ to: "COMPLETED", at: ist("2026-09-10", "20:00") }] }); // previous window
    await order(other, "2026-09-16", "COMPLETED", { events: [{ to: "COMPLETED", at: ist("2026-09-16", "20:00") }] }); // another org
    const raw = await getReadinessRaw(org.orgId, NOW);
    expect(raw.closedSameDay).toEqual({ numerator: 2, denominator: 4, previousNumerator: 1, previousDenominator: 1 });
  });
});

describe("cash recorded for completed cash orders", () => {
  it("counts completed orders with a cash payment, and those whose cash is recorded as received", async () => {
    await order(org, "2026-09-15", "COMPLETED", { cash: "CAPTURED" });
    await order(org, "2026-09-15", "COMPLETED", { cash: "REFUNDED" }); // was received, later refunded: still recorded
    await order(org, "2026-09-16", "COMPLETED", { cash: "PENDING" }); // completed, cash never recorded
    await order(org, "2026-09-16", "COMPLETED"); // no cash payment at all: not a cash order
    await order(org, "2026-09-16", "ACCEPTED", { cash: "PENDING" }); // not completed
    await order(other, "2026-09-15", "COMPLETED", { cash: "PENDING" });
    const raw = await getReadinessRaw(org.orgId, NOW);
    expect(raw.cashRecorded).toMatchObject({ numerator: 2, denominator: 3 });
  });
});

describe("orders with a customer attached", () => {
  it("counts live sales in the window with a customer; drafts, cancelled and failed are not sales", async () => {
    const customer = await createTestCustomer(org.orgId);
    const before = (await getReadinessRaw(org.orgId, NOW)).customerAttached;
    await order(org, "2026-09-19", "COMPLETED", { customerId: customer.id });
    await order(org, "2026-09-19", "COMPLETED");
    await order(org, "2026-09-19", "CANCELLED", { customerId: customer.id });
    await order(org, "2026-09-19", "FAILED");
    const after = (await getReadinessRaw(org.orgId, NOW)).customerAttached;
    expect(after.numerator - before.numerator).toBe(1);
    expect(after.denominator - before.denominator).toBe(2);
  });
});

describe("top-20 items with a recipe", () => {
  it("ranks by units sold in the last 30 finished days; a recipe with no version does not count; the trend uses the same items", async () => {
    const tax = await createTestTaxRate(org.orgId);
    const a = await createTestProduct(org.orgId, { taxRateId: tax.id, name: "Alpha Burger" });
    const b = await createTestProduct(org.orgId, { taxRateId: tax.id, name: "Bravo Wings" });
    const c = await createTestProduct(org.orgId, { taxRateId: tax.id, name: "Charlie Fries" });
    const d = await createTestProduct(org.orgId, { taxRateId: tax.id, name: "Delta Only Cancelled" });
    const ing = await createTestIngredient(org.orgId);
    await createTestRecipe(org.orgId, a.id, ing.id, 100); // costed
    await db().update(recipes).set({ createdAt: ist("2026-09-01", "10:00") }).where(eq(recipes.productId, a.id)); // existed a week ago
    await createTestRecipe(org.orgId, b.id, ing.id, 100); // costed, created just now (after the week-ago mark)
    await db().insert(recipes).values({ orgId: org.orgId, productId: c.id, yieldQuantity: 1 }); // bare header: no version
    await order(org, "2026-09-05", "COMPLETED", { items: [{ productId: a.id, name: "Alpha Burger", qty: 5 }, { productId: b.id, name: "Bravo Wings", qty: 4 }, { productId: c.id, name: "Charlie Fries", qty: 3 }] });
    await order(org, "2026-09-05", "CANCELLED", { items: [{ productId: d.id, name: "Delta Only Cancelled", qty: 99 }] }); // a cancelled sale does not rank, so Delta is not in the list
    const raw = await getReadinessRaw(org.orgId, NOW);
    // Only these three products exist in this org's sales in the window.
    expect(raw.recipeCoverage).toMatchObject({ numerator: 2, denominator: 3, previousNumerator: 1, previousDenominator: 3, firstMissingItem: "Charlie Fries" });
  });
});

describe("stock counted in the last 7 days", () => {
  it("counts stocked ingredients with a physical count that changed the balance, and the days since the last count", async () => {
    const [x, y, z] = [await createTestIngredient(org.orgId), await createTestIngredient(org.orgId), await createTestIngredient(org.orgId)];
    for (const i of [x, y, z]) await db().insert(inventoryItems).values({ orgId: org.orgId, ingredientId: i.id, locationId: org.locationId, quantityOnHand: 100 });
    const adj = (ingredientId: string, at: Date, notes: string) => db().insert(inventoryMovements).values({ orgId: org.orgId, ingredientId, locationId: org.locationId, type: "ADJUSTMENT", quantity: -5, notes, occurredAt: at });
    await adj(x.id, ist("2026-09-19", "10:00"), "Physical count: 95 g counted, 100 g on hand."); // in the last 7 days
    await adj(y.id, ist("2026-09-10", "10:00"), "Physical count: 95 g counted, 100 g on hand."); // the week before
    await adj(z.id, ist("2026-09-19", "10:00"), "Correction typed by hand"); // an adjustment, not a count
    const raw = await getReadinessRaw(org.orgId, NOW);
    expect(raw.stockCount).toMatchObject({ numerator: 1, previousNumerator: 1, daysSinceLastCount: 2 });
    expect(raw.stockCount.denominator).toBeGreaterThanOrEqual(3);
  });
});

describe("days since the last count are calendar days in the shop's own timezone", () => {
  it("a count at 23:30 last night reads 1 day at 00:10, not 0", async () => {
    const solo = await createTestOrg();
    try {
      const ing = await createTestIngredient(solo.orgId);
      await db().insert(inventoryItems).values({ orgId: solo.orgId, ingredientId: ing.id, locationId: solo.locationId, quantityOnHand: 100 });
      await db().insert(inventoryMovements).values({ orgId: solo.orgId, ingredientId: ing.id, locationId: solo.locationId, type: "ADJUSTMENT", quantity: -1, notes: "Physical count: 99 g counted, 100 g on hand.", occurredAt: ist("2026-09-20", "23:30") });
      expect((await getReadinessRaw(solo.orgId, ist("2026-09-21", "00:10"))).stockCount.daysSinceLastCount).toBe(1);
      expect((await getReadinessRaw(solo.orgId, ist("2026-09-20", "23:45"))).stockCount.daysSinceLastCount).toBe(0);
    } finally {
      await deleteTestOrg(solo.orgId);
    }
  });
});

describe("scoping and shape", () => {
  it("another org sees none of this org's rows", async () => {
    const raw = await getReadinessRaw(other.orgId, NOW);
    // The other org has exactly two orders in the window: one closed the same day, one completed cash order with no event.
    expect(raw.closedSameDay).toMatchObject({ numerator: 1, denominator: 2 });
    expect(raw.cashRecorded).toMatchObject({ numerator: 0, denominator: 1 });
    expect(raw.recipeCoverage.denominator).toBe(0);
    expect(raw.stockCount).toMatchObject({ denominator: 0, daysSinceLastCount: null });
  });

  it("an org with nothing recorded scores 'no data' everywhere, not zero and not 100", async () => {
    const empty = await createTestOrg();
    try {
      const r = await getReadiness(empty.orgId, NOW);
      expect(r.scores.every((s) => s.percent === null && s.state === "nodata")).toBe(true);
      expect(r.overallPercent).toBeNull();
      expect(r.action).toBeNull();
    } finally {
      await deleteTestOrg(empty.orgId);
    }
  });

  it("builds the whole readiness from the counts", async () => {
    const r = await getReadiness(org.orgId, NOW);
    expect(r.scores.map((s) => s.id)).toEqual(["closedSameDay", "cashRecorded", "recipeCoverage", "stockCount", "customerAttached"]);
    expect(r.overallPercent).not.toBeNull();
    expect(r.action).not.toBeNull();
  });
});

describe("analytics-start-date: pre-launch exclusion", () => {
  // Opening date 2026-09-16, inside the current window (09-14..09-20); the previous window (09-07..09-13) is entirely pre-launch.
  let launched: TestOrg;

  beforeAll(async () => {
    launched = await createTestOrg();
    await db().update(organizations).set({ openedOn: "2026-09-16" }).where(eq(organizations.id, launched.orgId));
    await order(launched, "2026-09-10", "COMPLETED", { events: [{ to: "COMPLETED", at: ist("2026-09-10", "20:00") }] }); // previous window, pre-launch
    await order(launched, "2026-09-14", "COMPLETED", { events: [{ to: "COMPLETED", at: ist("2026-09-14", "20:00") }] }); // current window, pre-launch
    await order(launched, "2026-09-17", "COMPLETED", { events: [{ to: "COMPLETED", at: ist("2026-09-17", "20:00") }] }); // current window, post-launch
  });
  afterAll(async () => {
    await deleteTestOrg(launched.orgId);
  });

  it("by default, excludes days before the Opening date from both windows", async () => {
    const raw = await getReadinessRaw(launched.orgId, NOW);
    expect(raw.closedSameDay).toMatchObject({ numerator: 1, denominator: 1, previousNumerator: 0, previousDenominator: 0 });
  });

  it("includePreLaunch: true counts every day, pre-launch included", async () => {
    const raw = await getReadinessRaw(launched.orgId, NOW, true);
    expect(raw.closedSameDay).toMatchObject({ numerator: 2, denominator: 2, previousNumerator: 1, previousDenominator: 1 });
  });

  it("getReadiness (the built score, not just the raw counts) also excludes pre-launch by default", async () => {
    const excluded = await getReadiness(launched.orgId, NOW);
    const included = await getReadiness(launched.orgId, NOW, true);
    const score = (r: Awaited<ReturnType<typeof getReadiness>>) => r.scores.find((s) => s.id === "closedSameDay")!;
    expect(score(excluded).denominator).toBe(1);
    expect(score(included).denominator).toBe(2);
  });

  it("an org with no Opening date set is never clamped — includePreLaunch has nothing to do", async () => {
    const raw = await getReadinessRaw(org.orgId, NOW);
    const rawIncluded = await getReadinessRaw(org.orgId, NOW, true);
    expect(raw.closedSameDay).toEqual(rawIncluded.closedSameDay);
  });

  it("stockCount is never clamped by the Opening date — it measures inventory hygiene, not an order trend", async () => {
    const ing = await createTestIngredient(launched.orgId);
    await db().insert(inventoryItems).values({ orgId: launched.orgId, ingredientId: ing.id, locationId: launched.locationId, quantityOnHand: 100 });
    // A physical count recorded before the Opening date.
    await db().insert(inventoryMovements).values({ orgId: launched.orgId, ingredientId: ing.id, locationId: launched.locationId, type: "ADJUSTMENT", quantity: -1, notes: "Physical count: 99 g counted, 100 g on hand.", occurredAt: ist("2026-09-15", "09:00") });
    const excluded = await getReadinessRaw(launched.orgId, ist("2026-09-16", "10:00"));
    const included = await getReadinessRaw(launched.orgId, ist("2026-09-16", "10:00"), true);
    expect(excluded.stockCount).toEqual(included.stockCount);
    expect(excluded.stockCount.numerator).toBe(1);
  });
});
