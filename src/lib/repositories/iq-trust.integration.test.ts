/**
 * IQ-1 S7: trust signals T1–T7 scored from real rows, on the RELIABILITY
 * fixtures. A double-capture day grades T6 LOW (REVIEW required change 3), a
 * business-date skew and an app/DB clock skew grade T5 LOW, and a metric's
 * trust names its limiting signal (I2).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { iqDailyTrust, ingredientPrices } from "@/db/schema";
import { paise } from "@/lib/money";
import { computeTrustDay, getMetricTrust } from "./iq-trust";
import { createTestIngredient, createTestProduct, createTestRecipe, type TestOrg, warmPool } from "./__test-support__/fixtures";
import {
  createTwoTestOrgs,
  istInstant,
  seedExpense,
  seedMovement,
  seedSale,
  seedSaleMovements,
  seedWasteEntry,
  type TwoOrgs,
} from "./__test-support__/iq-fixtures";

const CLEAN = "2026-09-02";
const DOUBLE = "2026-09-03";
const SKEW = "2026-09-04";

async function price(orgId: string, ingredientId: string, at: Date) {
  await db().insert(ingredientPrices).values({
    orgId,
    ingredientId,
    purchaseQuantity: 1000,
    purchaseUnit: "G",
    purchaseCost: paise(3_000n),
    costPerBaseUnit: paise(3n),
    costPerBaseUnitMilli: 3_000n,
    effectiveFrom: at,
  });
}

async function seed(org: TestOrg) {
  const fresh = await createTestIngredient(org.orgId, 3n);
  const stale = await createTestIngredient(org.orgId, 3n);
  await price(org.orgId, fresh.id, istInstant("2026-09-01"));
  await price(org.orgId, stale.id, istInstant("2026-08-01"));
  const burger = await createTestProduct(org.orgId, { name: "Trust burger" });
  await createTestRecipe(org.orgId, burger.id, fresh.id, 150);

  // CLEAN: covered, costed, fresh, waste logged, one capture, DIRECT expense the day before.
  const clean = await seedSale(org, { at: istInstant(CLEAN), lines: [{ productId: burger.id, unitPricePaise: 17_900n }] });
  await seedSaleMovements(org, clean.order, { ingredientId: fresh.id, perUnit: 150, costPerBaseUnitPaise: 3n });
  await seedWasteEntry(org, { at: istInstant(CLEAN, "22:00"), ingredientId: fresh.id, magnitude: 40, costPaise: 120n });
  await seedExpense(org, { behaviour: "DIRECT", amountPaise: 50_000n, paidOn: "2026-09-01" });

  // DOUBLE: captured twice; a ₹20 line with no recipe; a stale-priced and an uncosted SALE row; no waste.
  const double = await seedSale(org, {
    at: istInstant(DOUBLE),
    lines: [{ productId: burger.id, unitPricePaise: 17_900n }, { productId: null, name: "Dip", unitPricePaise: 2_000n }],
    payments: [{}, {}],
  });
  await seedMovement(org, { at: istInstant(DOUBLE), type: "SALE", ingredientId: stale.id, magnitude: 150, costPerBaseUnitPaise: 3n, orderId: double.order.id });
  await seedMovement(org, { at: istInstant(DOUBLE), type: "SALE", ingredientId: stale.id, magnitude: 10, costPerBaseUnitPaise: 0n, orderId: double.order.id });

  // SKEW: stored business date one day behind created_at, and placed 10 minutes after creation.
  await seedSale(org, {
    at: istInstant(SKEW),
    businessDate: DOUBLE,
    placedAt: istInstant(SKEW, "12:10"),
    lines: [{ productId: burger.id, unitPricePaise: 17_900n }],
  });
}

const gradesOf = (result: Awaited<ReturnType<typeof computeTrustDay>>) => Object.fromEntries(result.scores.map((s) => [s.signalId, s.grade]));
const scoreOf = (result: Awaited<ReturnType<typeof computeTrustDay>>, signalId: string) => result.scores.find((s) => s.signalId === signalId)!;

describe("IQ daily trust (IQ-1 S7)", () => {
  let orgs: TwoOrgs;

  beforeAll(async () => {
    orgs = await createTwoTestOrgs();
    await seed(orgs.a);
    // Org B: the same clean day but captured twice. It must not touch A's grades.
    const b = orgs.b;
    const product = await createTestProduct(b.orgId);
    await seedSale(b, { at: istInstant(CLEAN), lines: [{ productId: product.id, unitPricePaise: 17_900n }], payments: [{}, {}] });
    for (const date of [CLEAN, DOUBLE, SKEW]) await computeTrustDay(orgs.a.orgId, date);
    await computeTrustDay(b.orgId, CLEAN);
  }, 60_000);

  afterAll(async () => {
    await orgs.cleanup();
  });

  it("grades a clean day HIGH on every measured signal, T3 UNKNOWN", async () => {
    const result = await computeTrustDay(orgs.a.orgId, CLEAN);
    expect(gradesOf(result)).toEqual({
      t1_recipe_coverage: "HIGH",
      t1b_costed_sale_rows: "HIGH",
      t2_price_freshness: "HIGH",
      t3_stock_count_recency: "UNKNOWN",
      t4_waste_logging: "HIGH",
      t5_clock_sanity: "HIGH",
      t6_payment_integrity: "HIGH",
      t7_cost_recording: "HIGH",
    });
    expect(scoreOf(result, "t6_payment_integrity")).toMatchObject({ numerator: 1n, denominator: 1n });
  });

  it("grades a double-capture day T6 LOW and counts why", async () => {
    const result = await computeTrustDay(orgs.a.orgId, DOUBLE);
    const t6 = scoreOf(result, "t6_payment_integrity");
    expect(t6).toMatchObject({ grade: "LOW", numerator: 0n, denominator: 1n });
    expect(t6.detail).toMatchObject({ orders_checked: 1, multi_captured: 1, captured_not_grand_total: 1, partially_refunded: 0 });
  });

  it("grades coverage, costing, freshness and waste on the double-capture day against the design thresholds", async () => {
    const grades = gradesOf(await computeTrustDay(orgs.a.orgId, DOUBLE));
    // 17,048 of 18,953 paise covered = 89.9% (< 90%): MEDIUM.
    expect(grades.t1_recipe_coverage).toBe("MEDIUM");
    // 1 of 2 SALE rows costed: LOW. Only stale prices: LOW.
    expect(grades.t1b_costed_sale_rows).toBe("LOW");
    expect(grades.t2_price_freshness).toBe("LOW");
    // Waste logged on 1 of 2 sales days in the window: 1/2 < 5/7, ≥ 3/7: MEDIUM.
    expect(grades.t4_waste_logging).toBe("MEDIUM");
  });

  it("grades a business-date skew and a placed-at drift T5 LOW", async () => {
    const t5 = scoreOf(await computeTrustDay(orgs.a.orgId, SKEW), "t5_clock_sanity");
    expect(t5.grade).toBe("LOW");
    expect(t5.detail).toMatchObject({ orders_checked: 1, business_date_mismatch: 1, placed_drift: 1, timezone_mismatch: 0 });
  });

  it("grades an app clock more than 5 s off the database T5 LOW, and recovers on recompute", async () => {
    const skewed = scoreOf(await computeTrustDay(orgs.a.orgId, CLEAN, { appNow: new Date(Date.now() - 60_000) }), "t5_clock_sanity");
    expect(skewed.grade).toBe("LOW");
    expect(skewed.detail.clock_skew_ms).toBeGreaterThan(5_000);
    expect(scoreOf(await computeTrustDay(orgs.a.orgId, CLEAN), "t5_clock_sanity").grade).toBe("HIGH");
  });

  it("grades T7 MEDIUM with a DIRECT expense earlier in the month only, LOW with none", async () => {
    expect(scoreOf(await computeTrustDay(orgs.a.orgId, "2026-09-20"), "t7_cost_recording").grade).toBe("MEDIUM");
    expect(scoreOf(await computeTrustDay(orgs.a.orgId, "2026-10-05"), "t7_cost_recording").grade).toBe("LOW");
  });

  it("gives a metric the lowest signal grade and names the limiting signal and day (I2)", async () => {
    expect(await getMetricTrust(orgs.a.orgId, "revenue_net", CLEAN, CLEAN)).toMatchObject({ grade: "HIGH", limitingSignal: null, limitingDate: null });
    expect(await getMetricTrust(orgs.a.orgId, "revenue_net", DOUBLE, DOUBLE)).toMatchObject({
      grade: "LOW",
      limitingSignal: "t6_payment_integrity",
      limitingDate: DOUBLE,
    });
    expect(await getMetricTrust(orgs.a.orgId, "food_cost_actual", CLEAN, CLEAN)).toMatchObject({ grade: "UNKNOWN", limitingSignal: "t3_stock_count_recency" });
    expect(await getMetricTrust(orgs.a.orgId, "net_profit", CLEAN, SKEW)).toMatchObject({ grade: "LOW", limitingSignal: "t5_clock_sanity", limitingDate: SKEW });
  });

  it("treats a day never scored as UNKNOWN", async () => {
    expect(await getMetricTrust(orgs.a.orgId, "revenue_net", "2026-09-05", "2026-09-05")).toMatchObject({
      grade: "UNKNOWN",
      missingDates: ["2026-09-05"],
    });
  });

  it("keeps each org's grades to its own rows", async () => {
    expect((await getMetricTrust(orgs.a.orgId, "revenue_net", CLEAN, CLEAN)).grade).toBe("HIGH");
    expect(await getMetricTrust(orgs.b.orgId, "revenue_net", CLEAN, CLEAN)).toMatchObject({ grade: "LOW", limitingSignal: "t6_payment_integrity" });
  });

  it("stores detail as counts only and stays idempotent under concurrent runs", async () => {
    await warmPool(8);
    const results = await Promise.all([1, 2, 3].map(() => computeTrustDay(orgs.a.orgId, DOUBLE)));
    expect(results.every((r) => r.attempts <= 2)).toBe(true);
    const [row] = await db()
      .select({ n: count() })
      .from(iqDailyTrust)
      .where(and(eq(iqDailyTrust.orgId, orgs.a.orgId), eq(iqDailyTrust.businessDate, DOUBLE)));
    expect(row?.n).toBe(8);
    const stored = await db().select({ detail: iqDailyTrust.detail }).from(iqDailyTrust).where(eq(iqDailyTrust.orgId, orgs.a.orgId));
    for (const { detail } of stored) for (const value of Object.values(detail)) expect(typeof value).toBe("number");
  });
});
