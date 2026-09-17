/**
 * IQ-1 S9: the P&L page reads the daily facts, with trust, only when every
 * day of the period is closed and computed — and then its figures equal the
 * live queries to the paisa. Any other period (a day missing, today in range,
 * no facts tables on this database) reads live, exactly as before, with no
 * trust badge.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { type DateRange, addDays, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import { trustBadge } from "@/lib/finance/trust-badge";
import { paise } from "@/lib/money";
import { EXPENSE_REFRESH_BUDGET, createExpense, getProfitAndLoss, getProfitAndLossReport, type PnlReportSources, refreshFactsForDays } from "./expenses";
import { factDayLockKey, readDailyFacts, recomputeDay } from "./iq-facts";
import { computeTrustDay, getMetricTrust } from "./iq-trust";
import { getFoodCostComparison } from "./stock";
import { createTestIngredient, createTestProduct, type TestOrg } from "./__test-support__/fixtures";
import {
  createTwoTestOrgs,
  istInstant,
  seedExpense,
  seedExpenseCategory,
  seedMovement,
  seedRefund,
  seedSale,
  seedSaleMovements,
  seedTarget,
  type TwoOrgs,
} from "./__test-support__/iq-fixtures";

const range = (from: string, to: string, label = `${from}..${to}`): DateRange => ({ from: startOfBusinessDay(from), to: endOfBusinessDay(to), label });
const AUGUST = range("2026-08-01", "2026-08-31", "August 2026");
const SEP_1_TO_10 = range("2026-09-01", "2026-09-10");
const DOUBLE_DAY = "2026-08-15";

/** A clock on 17 Sep 2026, noon IST: August and 1–10 Sep are closed. */
const sourcesAt = (now: Date, overrides: Partial<PnlReportSources> = {}): PnlReportSources => ({
  readFacts: readDailyFacts,
  readTrust: getMetricTrust,
  now: () => now,
  ...overrides,
});
const AFTER = sourcesAt(istInstant("2026-09-17"));

async function seed(org: TestOrg): Promise<void> {
  const product = await createTestProduct(org.orgId, { name: "Report burger" });
  const ingredient = await createTestIngredient(org.orgId, 3n);

  // 1 Aug: rounding-sensitive ₹99 × 3 and a line with no catalogue product.
  const plain = await seedSale(org, { at: istInstant("2026-08-01"), lines: [{ productId: product.id, unitPricePaise: 9_900n, quantity: 3 }, { productId: null, name: "Dip", unitPricePaise: 2_000n }] });
  await seedSaleMovements(org, plain.order, { ingredientId: ingredient.id, perUnit: 120, costPerBaseUnitPaise: 3n });

  // 15 Aug: captured twice, and a sale partly refunded the next day.
  await seedSale(org, { at: istInstant(DOUBLE_DAY), lines: [{ productId: product.id, unitPricePaise: 17_900n }], payments: [{}, {}] });
  const partial = await seedSale(org, { at: istInstant(DOUBLE_DAY, "19:00"), lines: [{ productId: product.id, unitPricePaise: 39_900n }] });
  await seedRefund(partial.payments[0]!, { at: istInstant("2026-08-16", "10:00"), amountPaise: 5_000n });

  // IST midnight edges: 23:59:59.999 on 31 Aug is August, 00:00 on 1 Sep is September.
  await seedSale(org, { at: istInstant("2026-08-31", "23:59:59.999"), channel: "DINE_IN", lines: [{ productId: product.id, unitPricePaise: 19_900n }] });
  await seedSale(org, { at: istInstant("2026-09-01", "00:00"), lines: [{ productId: product.id, unitPricePaise: 14_900n }] });
  // 5 Sep: delivery fee and points.
  await seedSale(org, {
    at: istInstant("2026-09-05", "20:00"),
    channel: "ONLINE",
    fulfilment: "DELIVERY",
    deliveryFeePaise: 3_000n,
    pointsRedeemed: 10,
    pointsDiscountPaise: 1_000n,
    lines: [{ productId: product.id, unitPricePaise: 24_900n, quantity: 2 }],
  });

  // Expenses in two direct categories, one fixed, one non-operating, both sides of the boundary.
  const oil = await seedExpenseCategory(org, { behaviour: "DIRECT", name: "Oil" });
  await seedExpense(org, { behaviour: "DIRECT", amountPaise: 123_457n, paidOn: "2026-08-31" });
  await seedExpense(org, { categoryId: oil.id, amountPaise: 4_321n, paidOn: "2026-08-10" });
  await seedExpense(org, { behaviour: "FIXED", amountPaise: 1_500_000n, paidOn: "2026-08-01" });
  await seedExpense(org, { behaviour: "FIXED", nonOperating: true, amountPaise: 42_000n, paidOn: "2026-08-20" });
  await seedExpense(org, { behaviour: "DIRECT", amountPaise: 98_765n, paidOn: "2026-09-01" });
  await seedTarget(org, { month: "2026-08", foodCostTargetBps: 3_200 });

  await seedMovement(org, { at: istInstant("2026-08-20", "16:00"), type: "WASTE", ingredientId: ingredient.id, magnitude: 200, costPerBaseUnitPaise: 3n });
}

async function computeFacts(orgId: string, from: string, to: string, withTrust: boolean) {
  for (let d = from; d <= to; d = addDays(d, 1)) {
    await recomputeDay(orgId, d);
    if (withTrust) await computeTrustDay(orgId, d);
  }
}

describe("P&L report — facts with trust, live fallback (IQ-1 S9)", () => {
  let orgs: TwoOrgs;

  beforeAll(async () => {
    orgs = await createTwoTestOrgs();
    await seed(orgs.a);
    await seed(orgs.b);
    // Org B spends more, so any leak between the two shows as a mismatch.
    await seedExpense(orgs.b, { behaviour: "FIXED", amountPaise: 777_777n, paidOn: "2026-08-12" });
    for (const org of [orgs.a, orgs.b]) {
      await computeFacts(org.orgId, "2026-08-01", "2026-08-31", true);
      await computeFacts(org.orgId, "2026-09-01", "2026-09-10", false);
    }
  }, 180_000);

  afterAll(async () => {
    await orgs.cleanup();
  });

  it.each([
    ["August", AUGUST],
    ["1–10 September", SEP_1_TO_10],
  ] as const)("reads %s from facts, equal to the live P&L and food cost to the paisa", async (_label, period) => {
    const report = await getProfitAndLossReport(orgs.a.orgId, period, AFTER);
    expect(report.source).toBe("facts");
    expect(report.liveReason).toBeNull();
    expect(report.pnl).toEqual(await getProfitAndLoss(orgs.a.orgId, period));
    expect(report.foodCost).toEqual(await getFoodCostComparison(orgs.a.orgId, period));
    expect(report.pnl.revenue).toBeGreaterThan(0n);
    expect(report.pnl.hasExpenses).toBe(true);
  });

  it("carries August's full statement, not an empty one that happens to match", async () => {
    const { pnl, foodCost } = await getProfitAndLossReport(orgs.a.orgId, AUGUST, AFTER);
    // Four orders, net of 5% GST per line: 28,286 + 1,905 (1 Aug), 17,048 and 38,000 (15 Aug), 18,952 (31 Aug 23:59:59.999).
    expect(pnl.revenue).toBe(104_191n);
    expect(pnl.orderCount).toBe(4);
    expect(pnl.direct.map((row) => row.amount).sort()).toEqual([123_457n, 4_321n].sort());
    expect(pnl.fixed.map((row) => row.amount)).toEqual([1_500_000n]);
    expect(pnl.nonOperating.map((row) => row.amount)).toEqual([42_000n]);
    expect(pnl.result.netProfit).toBe(104_191n - 127_778n - 1_500_000n);
    expect(pnl.foodCostTargetBps).toBe(3_200);
    expect(foodCost.varianceCost).toBe(600n);
  });

  it("keeps each org to its own facts", async () => {
    const b = await getProfitAndLossReport(orgs.b.orgId, AUGUST, AFTER);
    expect(b.source).toBe("facts");
    expect(b.pnl).toEqual(await getProfitAndLoss(orgs.b.orgId, AUGUST));
    expect(b.pnl.result.operatingExpenses).toBe(1_500_000n + 777_777n);
    expect((await getProfitAndLossReport(orgs.a.orgId, AUGUST, AFTER)).pnl.result.operatingExpenses).toBe(1_500_000n);
  });

  it("grades a double-capture month LOW and names payment integrity and the day", async () => {
    const { trust } = await getProfitAndLossReport(orgs.a.orgId, AUGUST, AFTER);
    expect(trust?.revenue).toMatchObject({ grade: "LOW", limitingSignal: "t6_payment_integrity", limitingDate: DOUBLE_DAY, missingDates: [] });
    expect(trust?.netProfit.grade).toBe("LOW");
    expect(trustBadge("Net sales (excl. GST)", trust!.revenue)).toEqual({ tone: "loss", text: "Net sales (excl. GST): low trust — payment integrity, 15 Aug" });
  });

  it("falls back to live, with no trust, when a day in the period was never computed", async () => {
    const period = range("2026-09-01", "2026-09-11");
    const report = await getProfitAndLossReport(orgs.a.orgId, period, AFTER);
    expect(report).toMatchObject({ source: "live", liveReason: "missing_days", trust: null });
    expect(report.pnl).toEqual(await getProfitAndLoss(orgs.a.orgId, period));
    expect(report.foodCost).toEqual(await getFoodCostComparison(orgs.a.orgId, period));
  });

  it("reads live while the period still includes today, even with that day's facts computed", async () => {
    const report = await getProfitAndLossReport(orgs.a.orgId, SEP_1_TO_10, sourcesAt(istInstant("2026-09-10", "21:00")));
    expect(report).toMatchObject({ source: "live", liveReason: "open_day", trust: null });
    expect(report.pnl).toEqual(await getProfitAndLoss(orgs.a.orgId, SEP_1_TO_10));
  });

  it("reads live on a database without the facts tables, and rethrows any other failure", async () => {
    const undefinedTable = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error('relation "iq_daily_facts" does not exist'), { code: "42P01" }) });
    const report = await getProfitAndLossReport(orgs.a.orgId, AUGUST, sourcesAt(istInstant("2026-09-17"), { readFacts: () => Promise.reject(undefinedTable) }));
    expect(report).toMatchObject({ source: "live", liveReason: "no_fact_tables", trust: null });
    expect(report.pnl).toEqual(await getProfitAndLoss(orgs.a.orgId, AUGUST));

    const noTrustTable = await getProfitAndLossReport(orgs.a.orgId, AUGUST, sourcesAt(istInstant("2026-09-17"), { readTrust: () => Promise.reject(undefinedTable) }));
    expect(noTrustTable).toMatchObject({ source: "live", liveReason: "no_fact_tables", trust: null });

    const other = Object.assign(new Error("connection reset"), { code: "08006" });
    await expect(getProfitAndLossReport(orgs.a.orgId, AUGUST, sourcesAt(istInstant("2026-09-17"), { readFacts: () => Promise.reject(other) }))).rejects.toBe(other);
  });

  it("says trust was not scored, naming no signal, for facts computed without trust rows", async () => {
    const { source, trust } = await getProfitAndLossReport(orgs.a.orgId, SEP_1_TO_10, AFTER);
    expect(source).toBe("facts");
    expect(trust?.revenue.missingDates).toHaveLength(10);
    expect(trustBadge("Net sales (excl. GST)", trust!.revenue)).toEqual({ tone: "neutral", text: "Net sales (excl. GST): trust not scored for 10 days" });
  });

  it("shows an expense recorded today for last month at once on the facts path", async () => {
    // Last test in the file: it changes org A's August.
    const before = await getProfitAndLossReport(orgs.a.orgId, AUGUST, AFTER);
    const category = await seedExpenseCategory(orgs.a, { behaviour: "DIRECT" });
    await createExpense(orgs.a.orgId, { categoryId: category.id, description: "Late August invoice", amount: paise(11_111n), paidOn: "2026-08-20", accountId: null, reference: null });

    const after = await getProfitAndLossReport(orgs.a.orgId, AUGUST, AFTER);
    expect(after.source).toBe("facts");
    expect(after.pnl.result.directCosts).toBe(before.pnl.result.directCosts + 11_111n);
    expect(after.pnl).toEqual(await getProfitAndLoss(orgs.a.orgId, AUGUST));
    expect(after.trust?.revenue.missingDates).toEqual([]);
  });

  it("never fails the write when the facts refresh fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(refreshFactsForDays(orgs.a.orgId, ["2026-02-30"])).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("saves quickly while the day is locked by another run, skipping the refresh without a warning", async () => {
    const date = "2026-08-25";
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const holder = db().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${factDayLockKey(orgs.b.orgId, date)}, 0))`);
      held();
      await released;
    });
    await isHeld;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const category = await seedExpenseCategory(orgs.b, { behaviour: "DIRECT" });
      const started = Date.now();
      const saved = await createExpense(orgs.b.orgId, { categoryId: category.id, description: "During the nightly run", amount: paise(2_222n), paidOn: date, accountId: null, reference: null });
      // One wait of at most 2 s, never the job defaults (20 waits × 60 s).
      expect(EXPENSE_REFRESH_BUDGET).toEqual({ maxLockWaits: 1, lockWaitTimeoutMs: 2_000, statementTimeoutMs: 5_000 });
      expect(Date.now() - started).toBeLessThan(6_000);
      expect(await db().select({ id: expenses.id }).from(expenses).where(and(eq(expenses.id, saved.id), eq(expenses.orgId, orgs.b.orgId)))).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(expect.stringContaining("DAY_LOCK_BUSY"));
    } finally {
      warn.mockRestore();
      debug.mockRestore();
      release();
      await holder;
    }
  });

  it("computes nothing and logs nothing on a database without the facts tables", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const compute = vi.fn(async () => undefined);
    try {
      await refreshFactsForDays(orgs.a.orgId, ["2026-08-20"], { tablesExist: async () => false, recompute: compute, scoreTrust: compute });
      expect(compute).not.toHaveBeenCalled();

      // Tables dropped after the cached check: 42P01 from the compute is also silent.
      const undefinedTable = Object.assign(new Error("Failed query"), { cause: { code: "42P01" } });
      await refreshFactsForDays(orgs.a.orgId, ["2026-08-20", "2026-08-21"], { tablesExist: async () => true, recompute: () => Promise.reject(undefinedTable), scoreTrust: compute });
      expect(compute).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
