/**
 * IQ-1 acceptance: daily facts == the /app/iq/pnl figures, to the paisa.
 *
 * Seven business days across a month boundary (2026-08-29 .. 09-04): orders
 * on the IST midnight edges, a delivery fee, points, a 100% stamp reward, an
 * unpaid order, captured-then-cancelled, FAILED, a full refund, a partial
 * refund on a later day, a double capture, DIRECT/FIXED/non-operating
 * expenses on both sides of the boundary, SALE/RETURN/WASTE movements, waste
 * entries, and a second org holding the same rows.
 *
 * Parity per day, month-to-date and last month: getProfitAndLoss (revenue,
 * orders, expenses by category, profit result) and getFoodCostComparison
 * (theoretical, actual, sale movement count) against readDailyFacts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses, iqDailyFacts, refunds } from "@/db/schema";
import { type DateRange, addDays, endOfBusinessDay, resolveRange, startOfBusinessDay } from "@/lib/dates";
import { profit } from "@/lib/iq/profit";
import { FEES_DIMENSION_VALUE, V1_COMPUTED_METRIC_IDS } from "@/lib/iq/metrics";
import { paise } from "@/lib/money";
import { type CategoryTotal, getProfitAndLoss } from "./expenses";
import { type DailyFactsRead, DayLockBusyError, DayTimeoutError, businessDatesOf, factDayLockKey, readDailyFacts, recomputeDay, runLockedDayTransaction } from "./iq-facts";
import { getFoodCostComparison } from "./stock";
import { createTestIngredient, createTestProduct, type TestOrg, warmPool } from "./__test-support__/fixtures";
import {
  type SeededOrder,
  createTwoTestOrgs,
  istInstant,
  seedExpense,
  seedMovement,
  seedOrder,
  seedRefund,
  seedSale,
  seedSaleMovements,
  seedWasteEntry,
  type TwoOrgs,
} from "./__test-support__/iq-fixtures";

const DAYS = ["2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"] as const;
const NOW = istInstant("2026-09-04", "21:00");

const dayRange = (date: string): DateRange => ({ from: startOfBusinessDay(date), to: endOfBusinessDay(date), label: date });

interface Golden {
  readonly edge2359: SeededOrder;
  readonly edge0000: SeededOrder;
  readonly partial: SeededOrder;
  readonly double: SeededOrder;
  readonly fullRefund: SeededOrder;
}

async function seed(org: TestOrg): Promise<Golden> {
  const product = await createTestProduct(org.orgId, { name: "Fixture burger" });
  const ingredient = await createTestIngredient(org.orgId, 3n);

  // 29 Aug noon: two lines, one with no catalogue product; ₹99 inclusive is rounding-sensitive.
  const plain = await seedSale(org, {
    at: istInstant("2026-08-29"),
    lines: [{ productId: product.id, unitPricePaise: 9_900n, quantity: 3 }, { productId: null, name: "Dip", unitPricePaise: 2_000n }],
  });
  await seedSaleMovements(org, plain.order, { ingredientId: ingredient.id, perUnit: 120, costPerBaseUnitPaise: 3n });

  // IST midnight edges.
  const edge2359 = await seedSale(org, { at: istInstant("2026-08-31", "23:59:59.999"), channel: "DINE_IN", lines: [{ productId: product.id, unitPricePaise: 19_900n }] });
  await seedSaleMovements(org, edge2359.order, { ingredientId: ingredient.id, perUnit: 150, costPerBaseUnitPaise: 3n });
  const edge0000 = await seedSale(org, { at: istInstant("2026-09-01", "00:00"), lines: [{ productId: product.id, unitPricePaise: 14_900n }] });
  await seedSaleMovements(org, edge0000.order, { ingredientId: ingredient.id, perUnit: 110, costPerBaseUnitPaise: 3n });

  // 00:10: online delivery with a fee and points.
  await seedSale(org, {
    at: istInstant("2026-09-01", "00:10"),
    channel: "ONLINE",
    fulfilment: "DELIVERY",
    deliveryFeePaise: 3_000n,
    pointsRedeemed: 10,
    pointsDiscountPaise: 1_000n,
    lines: [{ productId: product.id, unitPricePaise: 24_900n, quantity: 2 }],
  });
  // A 100% stamp reward: zero taxable, still paid.
  await seedSale(org, { at: istInstant("2026-09-01", "13:00"), stampRewardLine: 0, lines: [{ productId: product.id, unitPricePaise: 9_900n }] });

  // 2 Sep: unpaid, captured-then-cancelled, FAILED.
  await seedOrder(org, { at: istInstant("2026-09-02", "11:00"), status: "PENDING_PAYMENT", lines: [{ productId: product.id, unitPricePaise: 9_900n }] });
  await seedSale(org, { at: istInstant("2026-09-02", "12:00"), status: "CANCELLED", lines: [{ productId: product.id, unitPricePaise: 9_900n }] });
  await seedSale(org, { at: istInstant("2026-09-02", "12:30"), status: "FAILED", payments: [{ status: "FAILED" }], lines: [{ productId: product.id, unitPricePaise: 9_900n }] });

  // 3 Sep: a full refund the same day, and a sale partially refunded on 4 Sep.
  const fullRefund = await seedSale(org, { at: istInstant("2026-09-03", "14:00"), status: "REFUNDED", lines: [{ productId: product.id, unitPricePaise: 29_900n }] });
  await seedRefund(fullRefund.payments[0]!, { at: istInstant("2026-09-03", "15:00"), amountPaise: fullRefund.order.grandTotal });
  const partial = await seedSale(org, { at: istInstant("2026-09-03", "19:00"), lines: [{ productId: product.id, unitPricePaise: 39_900n }] });
  await seedRefund(partial.payments[0]!, { at: istInstant("2026-09-04", "10:00"), amountPaise: 5_000n });

  // 4 Sep: captured twice.
  const double = await seedSale(org, { at: istInstant("2026-09-04", "12:00"), lines: [{ productId: product.id, unitPricePaise: 17_900n }], payments: [{}, {}] });

  // Expenses on both sides of the boundary.
  const direct = await seedExpense(org, { behaviour: "DIRECT", amountPaise: 123_457n, paidOn: "2026-08-31" });
  await seedExpense(org, { categoryId: direct.categoryId, amountPaise: 98_765n, paidOn: "2026-09-01" });
  await seedExpense(org, { behaviour: "FIXED", amountPaise: 1_500_000n, paidOn: "2026-09-01" });
  await seedExpense(org, { behaviour: "FIXED", nonOperating: true, amountPaise: 42_000n, paidOn: "2026-09-02" });

  // Inventory: a WASTE movement with its entry, a cooked-then-cancelled entry with no movement (D7), a RETURN at 00:00.
  const wasteMove = await seedMovement(org, { at: istInstant("2026-09-02", "16:00"), type: "WASTE", ingredientId: ingredient.id, magnitude: 200, costPerBaseUnitPaise: 3n });
  await seedWasteEntry(org, { at: istInstant("2026-09-02", "16:00"), ingredientId: ingredient.id, magnitude: 200, costPaise: 600n, movementId: wasteMove.id });
  await seedWasteEntry(org, { at: istInstant("2026-09-02", "23:59:59.999"), ingredientId: ingredient.id, magnitude: 90, costPaise: 270n, reason: "CANCELLED_ORDER" });
  await seedMovement(org, { at: istInstant("2026-09-03", "00:00"), type: "RETURN", ingredientId: ingredient.id, magnitude: 50, costPerBaseUnitPaise: 3n });

  return { edge2359: edge2359.order, edge0000: edge0000.order, partial: partial.order, double: double.order, fullRefund: fullRefund.order };
}

/** P&L expense lines as categoryId → amount, the shape the facts breakdown has. */
const byCategory = (rows: readonly CategoryTotal[]) => Object.fromEntries(rows.map((row) => [row.categoryId, row.amount]));

async function expectParity(orgId: string, range: DateRange) {
  const { from, to } = businessDatesOf(range);
  const [facts, pnl, food] = await Promise.all([readDailyFacts(orgId, from, to), getProfitAndLoss(orgId, range), getFoodCostComparison(orgId, range)]);

  expect(facts.missingDates).toEqual([]);
  const total = (id: keyof typeof facts.totals) => facts.totals[id] ?? 0n;
  const categories = (id: "expense_direct" | "expense_operating" | "expense_nonoperating") => facts.breakdowns[id]?.expense_category ?? {};

  expect(total("revenue_net")).toBe(pnl.revenue);
  expect(total("orders_paid")).toBe(BigInt(pnl.orderCount));
  expect(categories("expense_direct")).toEqual(byCategory(pnl.direct));
  expect(categories("expense_operating")).toEqual(byCategory(pnl.fixed));
  expect(categories("expense_nonoperating")).toEqual(byCategory(pnl.nonOperating));
  expect(
    profit({
      revenue: paise(total("revenue_net")),
      directCosts: paise(total("expense_direct")),
      operatingExpenses: paise(total("expense_operating")),
    }),
  ).toEqual(pnl.result);

  expect(total("food_cost_theoretical")).toBe(food.theoreticalCost);
  expect(total("food_cost_actual")).toBe(food.actualCost);
  expect(total("sale_lines_total")).toBe(BigInt(food.saleMovementCount));
  return facts;
}

describe("IQ daily facts — P&L parity (IQ-1 S6)", () => {
  let orgs: TwoOrgs;
  let golden: Golden;
  let otherGolden: Golden;
  const mtd = resolveRange("mtd", NOW);
  const lastMonth = resolveRange("lastMonth", NOW);

  const recomputeAll = async (orgId: string) => {
    for (let d = businessDatesOf(lastMonth).from; d <= businessDatesOf(mtd).to; d = addDays(d, 1)) await recomputeDay(orgId, d);
  };

  beforeAll(async () => {
    orgs = await createTwoTestOrgs();
    golden = await seed(orgs.a);
    otherGolden = await seed(orgs.b);
    await recomputeAll(orgs.a.orgId);
    await recomputeAll(orgs.b.orgId);
  }, 120_000);

  afterAll(async () => {
    await orgs.cleanup();
  });

  it.each(DAYS)("matches the P&L and food cost on %s", async (date) => {
    await expectParity(orgs.a.orgId, dayRange(date));
  });

  it("matches the P&L month to date and last month", async () => {
    await expectParity(orgs.a.orgId, mtd);
    await expectParity(orgs.a.orgId, lastMonth);
  });

  it("puts 23:59:59.999 IST on its own day and 00:00 IST on the next", async () => {
    const aug31 = await readDailyFacts(orgs.a.orgId, "2026-08-31", "2026-08-31");
    const sep01 = await readDailyFacts(orgs.a.orgId, "2026-09-01", "2026-09-01");
    expect(aug31.totals.revenue_net).toBe(golden.edge2359.taxableTotal);
    expect(aug31.breakdowns.orders_paid?.channel).toEqual({ DINE_IN: 1n });
    expect(sep01.totals.orders_paid).toBe(3n);
  });

  it("counts a partial refund's order once, on its sale day, and the refund on its own day", async () => {
    const sep03 = await readDailyFacts(orgs.a.orgId, "2026-09-03", "2026-09-03");
    expect(sep03.totals.revenue_net).toBe(golden.partial.taxableTotal);
    expect(sep03.totals.orders_refunded).toBe(1n);
    expect(sep03.totals.refunds_amount).toBe(golden.fullRefund.grandTotal);
    const sep04 = await readDailyFacts(orgs.a.orgId, "2026-09-04", "2026-09-04");
    expect(sep04.totals.refunds_amount).toBe(5_000n);
  });

  it("counts a double-captured order once, while captured_amount keeps both payments", async () => {
    const sep04 = await readDailyFacts(orgs.a.orgId, "2026-09-04", "2026-09-04");
    expect(sep04.totals.orders_paid).toBe(1n);
    expect(sep04.totals.revenue_net).toBe(golden.double.taxableTotal);
    expect(sep04.totals.captured_amount).toBe(golden.double.grandTotal * 2n);
  });

  it("writes every v1 metric every day, and products (with fees) sum to revenue", async () => {
    for (const date of DAYS) {
      const facts = await readDailyFacts(orgs.a.orgId, date, date);
      for (const id of V1_COMPUTED_METRIC_IDS) expect(facts.totals[id], `${id} on ${date}`).toBeDefined();
      const products = Object.values(facts.breakdowns.revenue_net_by_product?.product ?? {}).reduce((sum, v) => sum + v, 0n);
      expect(products).toBe(facts.totals.revenue_net);
    }
    const sep01 = await readDailyFacts(orgs.a.orgId, "2026-09-01", "2026-09-01");
    expect(sep01.breakdowns.revenue_net_by_product?.product?.[FEES_DIMENSION_VALUE]).toBeGreaterThan(0n);
  });

  it("reports days never computed as missing, not zero", async () => {
    const facts = await readDailyFacts(orgs.a.orgId, "2026-09-04", "2026-09-06");
    expect(facts.computedDates).toEqual(["2026-09-04"]);
    expect(facts.missingDates).toEqual(["2026-09-05", "2026-09-06"]);
  });

  it("is idempotent", async () => {
    const rowsFor = async () =>
      (await db().select({ n: count() }).from(iqDailyFacts).where(and(eq(iqDailyFacts.orgId, orgs.a.orgId), eq(iqDailyFacts.businessDate, "2026-09-01"))))[0]?.n;
    const before = await rowsFor();
    const first = await readDailyFacts(orgs.a.orgId, "2026-09-01", "2026-09-01");
    const again = await recomputeDay(orgs.a.orgId, "2026-09-01");
    expect(again).toMatchObject({ lockWaits: 0, attempts: 1 });
    expect(await rowsFor()).toBe(before);
    expect(await readDailyFacts(orgs.a.orgId, "2026-09-01", "2026-09-01")).toEqual(first);
  });

  it("waits for a recompute in progress rather than computing a stale snapshot; readers see all old or all new rows", async () => {
    const orgId = orgs.a.orgId;
    const date = "2026-09-02";
    await warmPool(10);
    const before = await readDailyFacts(orgId, date, date);

    // Hold the day's lock, as a recompute in progress would.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const holder = db().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${factDayLockKey(orgId, date)}, 0))`);
      held();
      await released;
    });
    await isHeld;

    // New source data the waiters must see once they get the lock.
    const extra = await seedExpense(orgs.a, { behaviour: "DIRECT", amountPaise: 777n, paidOn: date, description: "Concurrency" });
    const recomputes = Array.from({ length: 5 }, () => recomputeDay(orgId, date));

    // Proof of overlap: all five are blocked on the held lock at the same moment.
    const waiting = async () =>
      Number((await db().execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`))[0]?.n ?? 0);
    for (let tries = 0; (await waiting()) < 5; tries++) {
      if (tries > 200) throw new Error("recomputes never queued on the lock");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const reads: DailyFactsRead[] = [];
    let reading = true;
    const reader = (async () => {
      while (reading) reads.push(await readDailyFacts(orgId, date, date));
    })();

    release();
    await holder;
    const results = await Promise.all(recomputes);
    reading = false;
    await reader;

    const after = await readDailyFacts(orgId, date, date);
    expect(after.totals.expense_direct).toBe((before.totals.expense_direct ?? 0n) + 777n);
    for (const result of results) {
      expect(result.lockWaits).toBeGreaterThanOrEqual(1);
      // Waiting costs no attempt; only a commit landing between snapshot and lock can force one retry.
      expect(result.attempts).toBeLessThanOrEqual(2);
    }
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect([before, after]).toContainEqual(read);

    await db().delete(expenses).where(and(eq(expenses.id, extra.id), eq(expenses.orgId, orgId)));
    await recomputeDay(orgId, date);
    expect(await readDailyFacts(orgId, date, date)).toEqual(before);
  });

  it("matches hand-computed figures (₹ inclusive of 5% GST, extracted per line)", async () => {
    const sep = await readDailyFacts(orgs.a.orgId, "2026-09-01", "2026-09-04");
    const aug = await readDailyFacts(orgs.a.orgId, "2026-08-29", "2026-08-31");
    const sep02 = await readDailyFacts(orgs.a.orgId, "2026-09-02", "2026-09-02");
    const sep03 = await readDailyFacts(orgs.a.orgId, "2026-09-03", "2026-09-03");

    // September: 149 + (498 + 30 fee − 10 points) + stamp-free 99 + 399 (partial refund) + 179 (captured twice).
    expect(sep.totals).toMatchObject({
      orders_paid: 5n,
      revenue_net: 119_524n, // 14,190 + 50,286 + 0 + 38,000 + 17,048
      gst_output: 5_976n, // 710 + 2,514 + 0 + 1,900 + 852
      sales_gross: 124_500n, // 14,900 + 51,800 + 0 + 39,900 + 17,900
      discount_total: 9_900n, // the stamp reward; points are tender, not discount
      units_sold: 6n,
      orders_comp: 1n,
      orders_part_refunded: 1n,
      orders_refunded: 1n,
      orders_cancelled: 1n,
      orders_failed: 1n,
      expense_direct: 98_765n,
      expense_operating: 1_500_000n,
      expense_nonoperating: 42_000n,
    });
    expect(
      profit({ revenue: paise(sep.totals.revenue_net ?? 0n), directCosts: paise(sep.totals.expense_direct ?? 0n), operatingExpenses: paise(sep.totals.expense_operating ?? 0n) })
        .netProfit,
    ).toBe(-1_479_241n);

    // August: 3 × 99 + 20 dip on the 29th, 199 at 23:59:59.999 on the 31st.
    expect(aug.totals).toMatchObject({ orders_paid: 2n, revenue_net: 49_143n, gst_output: 2_457n, sales_gross: 51_600n, units_sold: 5n, expense_direct: 123_457n });

    expect(sep02.totals.waste_cost).toBe(870n); // 600 logged + 270 cooked-then-cancelled
    expect(sep03.totals.orders_part_refunded).toBe(1n);
    expect(sep03.totals.refunds_amount).toBe(29_900n);
  });

  it("keeps each org's facts to its own rows", async () => {
    const a = await readDailyFacts(orgs.a.orgId, "2026-08-29", "2026-09-04");
    const b = await readDailyFacts(orgs.b.orgId, "2026-08-29", "2026-09-04");
    // Same shapes, so the same totals — but each org's own categories.
    expect(b.totals.revenue_net).toBe(a.totals.revenue_net);
    expect(Object.keys(b.breakdowns.expense_direct?.expense_category ?? {})).not.toEqual(Object.keys(a.breakdowns.expense_direct?.expense_category ?? {}));
    expect(otherGolden.double.orgId).toBe(orgs.b.orgId);
    await expectParity(orgs.b.orgId, mtd);
  });

  it("drops a breakdown row when its source is gone", async () => {
    const extra = await seedExpense(orgs.a, { behaviour: "DIRECT", amountPaise: 1n, paidOn: "2026-08-30", description: "Removed later" });
    await recomputeDay(orgs.a.orgId, "2026-08-30");
    expect((await readDailyFacts(orgs.a.orgId, "2026-08-30", "2026-08-30")).breakdowns.expense_direct?.expense_category).toEqual({ [extra.categoryId]: 1n });

    await db().delete(expenses).where(and(eq(expenses.id, extra.id), eq(expenses.orgId, orgs.a.orgId)));
    await recomputeDay(orgs.a.orgId, "2026-08-30");
    const after = await expectParity(orgs.a.orgId, dayRange("2026-08-30"));
    expect(after.breakdowns.expense_direct).toBeUndefined();
    expect(after.totals.expense_direct).toBe(0n);
  });

  it("counts a double capture with one capture refunded once, as partially refunded, revenue unchanged", async () => {
    // 28 Aug: outside every day the goldens and org comparisons read; recomputed here only.
    const date = "2026-08-28";
    const product = await createTestProduct(orgs.a.orgId, { name: "Mixed capture" });
    const sale = await seedSale(orgs.a, { at: istInstant(date, "18:00"), lines: [{ productId: product.id, unitPricePaise: 17_900n }], payments: [{}, {}] });
    const refund = await seedRefund(sale.payments[1]!, { at: istInstant(date, "18:30"), amountPaise: sale.order.grandTotal });
    expect(refund.paymentStatus).toBe("REFUNDED");

    await recomputeDay(orgs.a.orgId, date);
    const facts = await expectParity(orgs.a.orgId, dayRange(date));
    expect(facts.totals).toMatchObject({
      orders_paid: 1n,
      revenue_net: 17_048n,
      orders_part_refunded: 1n,
      orders_refunded: 0n,
      captured_amount: 35_800n,
      refunds_amount: 17_900n,
    });
  });

  it("refuses a date that is not a business date", async () => {
    await expect(recomputeDay(orgs.a.orgId, "2026-02-30")).rejects.toThrow(RangeError);
    await expect(readDailyFacts(orgs.a.orgId, "2026-09-04", "2026-09-01")).rejects.toThrow(RangeError);
  });

  it("counts only SUCCEEDED refunds, on the IST day they were finalized (refund release, 0038)", async () => {
    // 25–26 Aug: outside the goldens; refunds are not a P&L figure, so parity is unaffected.
    const org = orgs.a;
    const sale = await seedSale(org, { at: istInstant("2026-08-25", "12:00"), lines: [{ unitPricePaise: 59_900n }] });
    const payment = sale.payments[0]!;
    const row = (status: "RESERVED" | "SUCCEEDED" | "FAILED", amount: bigint, createdAt: Date, finalizedAt: Date | null) => ({
      orgId: org.orgId,
      paymentId: payment.id,
      orderId: sale.order.id,
      amount: paise(amount),
      reason: `Fixture ${status}`,
      provider: "cash",
      status,
      finalizedAt,
      createdAt,
      updatedAt: createdAt,
    });
    await db()
      .insert(refunds)
      .values([
        row("RESERVED", 1_111n, istInstant("2026-08-25", "13:00"), null),
        row("FAILED", 2_222n, istInstant("2026-08-25", "14:00"), null),
        // Reserved at 23:59 on the 25th, finalized at 00:05 on the 26th.
        row("SUCCEEDED", 3_333n, istInstant("2026-08-25", "23:59"), istInstant("2026-08-26", "00:05")),
      ]);
    await recomputeDay(org.orgId, "2026-08-25");
    await recomputeDay(org.orgId, "2026-08-26");

    expect((await readDailyFacts(org.orgId, "2026-08-25", "2026-08-25")).totals.refunds_amount).toBe(0n);
    expect((await readDailyFacts(org.orgId, "2026-08-26", "2026-08-26")).totals.refunds_amount).toBe(3_333n);
  });
});

describe("day lock timeouts (design P2)", () => {
  const key = `iq_daily_facts:timeout-test:${Date.now()}`;
  const lockIsFree = async () =>
    (await runLockedDayTransaction(key, "timeout test", async () => "free", { maxLockWaits: 0 })).value === "free";

  it("cuts off a slow statement with DayTimeoutError and releases the lock", async () => {
    const started = Date.now();
    const error = await runLockedDayTransaction(key, "timeout test", async (tx) => tx.execute(sql`SELECT pg_sleep(5)`), { statementTimeoutMs: 200 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DayTimeoutError);
    expect(error).toMatchObject({ code: "DAY_TIMEOUT", reason: "statement", retriable: false, timeoutMs: 200 });
    expect(error).not.toBeInstanceOf(DayLockBusyError);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(await lockIsFree()).toBe(true);
  });

  it("cuts off a holder idle in its transaction and releases the lock", async () => {
    const error = await runLockedDayTransaction(
      key,
      "timeout test",
      async (tx) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return tx.execute(sql`SELECT 1`);
      },
      { idleInTransactionTimeoutMs: 200 },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DayTimeoutError);
    expect(error).toMatchObject({ code: "DAY_TIMEOUT", reason: "idle_in_transaction" });
    expect(await lockIsFree()).toBe(true);
  });

  it("applies the default budget when none is given", async () => {
    const [row] = await runLockedDayTransaction(key, "timeout test", async (tx) =>
      tx.execute<{ statement: string; idle: string }>(sql`SELECT current_setting('statement_timeout') AS statement, current_setting('idle_in_transaction_session_timeout') AS idle`),
    ).then((r) => r.value);
    expect(row).toEqual({ statement: "30s", idle: "30s" });
  });
});
