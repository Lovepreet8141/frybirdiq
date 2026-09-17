import "server-only";

/**
 * Money out, and the profit-and-loss that becomes possible once it is recorded.
 *
 * Revenue is not stored here. It comes from `paidOrders` in
 * `src/lib/repositories/analytics.ts` — the same query the dashboard reads,
 * not a second copy of it. Keeping a second revenue definition in an
 * expenses module would let the P&L and the dashboard disagree, and the
 * first refund would make them.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { accounts, expenseCategories, expenses, targets } from "@/db/schema";
import { type DateRange, addDays, businessDate, daysInRange, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import { type Bps, type Paise, ZERO, add, paise, ratioBps, subtract } from "@/lib/money";
import { netRevenueOf, profit, type ProfitResult } from "@/lib/iq/profit";
import { paidOrders } from "@/lib/repositories/analytics";
import { type DailyFactsRead, readDailyFacts, recomputeDay } from "@/lib/repositories/iq-facts";
import { type MetricTrustRead, computeTrustDay, getMetricTrust } from "@/lib/repositories/iq-trust";
import { type FoodCostComparison, getFoodCostComparison } from "@/lib/repositories/stock";

export interface ExpenseRow {
  readonly id: string;
  readonly description: string;
  readonly amount: Paise;
  readonly paidOn: string;
  readonly categoryName: string;
  readonly behaviour: "DIRECT" | "FIXED";
  readonly accountName: string | null;
}

export interface CategoryTotal {
  readonly categoryId: string;
  readonly name: string;
  readonly behaviour: "DIRECT" | "FIXED";
  readonly isNonOperating: boolean;
  readonly amount: Paise;
}

/**
 * The first and last IST business dates a range covers, inclusive.
 *
 * `paidOn` is a date column holding the Ambala calendar date, so the range's
 * instants are narrowed with `businessDate`, never `toISOString()`: a range
 * starts at midnight IST, which is 18:30 UTC the day before, and the UTC date
 * of that instant would pull the previous day's expenses into the period.
 * `to` is exclusive, so the last covered date is the one just before it.
 */
function businessDateBounds(range: DateRange): { from: string; to: string } {
  return { from: businessDate(range.from), to: businessDate(new Date(range.to.getTime() - 1)) };
}

/** Spending in a period, grouped by category, by IST business date. */
export async function expenseTotals(orgId: string, range: DateRange): Promise<CategoryTotal[]> {
  const { from, to } = businessDateBounds(range);

  const rows = await db()
    .select({
      categoryId: expenseCategories.id,
      name: expenseCategories.name,
      behaviour: expenseCategories.behaviour,
      isNonOperating: expenseCategories.isNonOperating,
      total: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(eq(expenses.orgId, orgId), gte(expenses.paidOn, from), lte(expenses.paidOn, to)))
    .groupBy(
      expenseCategories.id,
      expenseCategories.name,
      expenseCategories.behaviour,
      expenseCategories.isNonOperating,
      expenseCategories.sortOrder,
    )
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name));

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    behaviour: r.behaviour,
    isNonOperating: r.isNonOperating,
    amount: paise(BigInt(r.total)),
  }));
}

export interface ProfitAndLoss {
  readonly range: DateRange;
  readonly revenue: Paise;
  readonly orderCount: number;
  readonly direct: readonly CategoryTotal[];
  readonly fixed: readonly CategoryTotal[];
  readonly nonOperating: readonly CategoryTotal[];
  readonly result: ProfitResult;
  /** Null when no target has been set for the period — never a guess. */
  readonly foodCostTargetBps: Bps | null;
  /** True when nothing has been recorded, so a screen can say so plainly. */
  readonly hasExpenses: boolean;
}

export async function getProfitAndLoss(orgId: string, range: DateRange): Promise<ProfitAndLoss> {
  const [paid, totals, target] = await Promise.all([paidOrders(orgId, range), expenseTotals(orgId, range), monthTarget(orgId, range)]);
  // netRevenueOf, not a sum of grandTotal — every margin figure below
  // (`profit()`) is only correct against net-of-tax revenue. See its own
  // doc comment in src/lib/iq/profit.ts.
  return shapeProfitAndLoss(range, netRevenueOf(paid), paid.length, totals, target);
}

/**
 * The statement from its inputs. One shaping for the live query and the daily
 * facts, so the two paths cannot lay out the same figures differently.
 */
function shapeProfitAndLoss(range: DateRange, revenue: Paise, orderCount: number, totals: readonly CategoryTotal[], target: Bps | null): ProfitAndLoss {
  const operating = totals.filter((t) => !t.isNonOperating);
  const direct = operating.filter((t) => t.behaviour === "DIRECT");
  const fixed = operating.filter((t) => t.behaviour === "FIXED");
  const nonOperating = totals.filter((t) => t.isNonOperating);

  const sum = (rows: readonly CategoryTotal[]): Paise =>
    rows.reduce<Paise>((acc, row) => paise(acc + row.amount), ZERO);

  return {
    range,
    revenue,
    orderCount,
    direct,
    fixed,
    nonOperating,
    result: profit({
      revenue,
      directCosts: sum(direct),
      operatingExpenses: sum(fixed),
    }),
    foodCostTargetBps: target,
    hasExpenses: totals.length > 0,
  };
}

/**
 * The food-cost target for the IST month a range starts in, if one was set.
 * Targets are saved under the month the owner picked in Ambala
 * (`setFoodCostTarget`), so the month is read from the business date.
 */
export async function monthTarget(orgId: string, range: DateRange): Promise<Bps | null> {
  const month = `${businessDateBounds(range).from.slice(0, 7)}-01`;
  const rows = await db()
    .select({ bps: targets.foodCostTargetBps })
    .from(targets)
    .where(and(eq(targets.orgId, orgId), eq(targets.month, month)))
    .limit(1);
  const value = rows[0]?.bps;
  return value === undefined || value === null ? null : (value as Bps);
}

export async function listExpenses(orgId: string, range: DateRange, limit = 100): Promise<ExpenseRow[]> {
  const { from, to } = businessDateBounds(range);

  const rows = await db()
    .select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      paidOn: expenses.paidOn,
      categoryName: expenseCategories.name,
      behaviour: expenseCategories.behaviour,
      accountName: accounts.name,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(accounts, eq(accounts.id, expenses.accountId))
    .where(and(eq(expenses.orgId, orgId), gte(expenses.paidOn, from), lte(expenses.paidOn, to)))
    .orderBy(desc(expenses.paidOn), desc(expenses.createdAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, amount: paise(r.amount) }));
}

export interface FoodCostPoint {
  readonly weekStart: string;
  readonly weekLabel: string;
  readonly revenue: Paise;
  readonly directCost: Paise;
  /** Null when the week had no revenue — a closed week is not a 0% week. */
  readonly foodCostBps: Bps | null;
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * Food cost % by week, most recent last.
 *
 * Bucketed by week rather than by day because `expenses.paidOn` records when
 * an owner pays for a delivery, not when it is used — a week's flour bought on
 * Monday is one row, not seven. A daily ratio would swing from 0% to some huge
 * spike on purchase days and say nothing true about any single day; a week is
 * close to the shortest window an owner actually restocks on, so it is the
 * shortest window this ratio means anything meaningful in.
 */
export async function foodCostWeeklySeries(orgId: string, weeks = 8): Promise<readonly FoodCostPoint[]> {
  const today = businessDate();
  const totalDays = weeks * 7;
  const range: DateRange = {
    from: startOfBusinessDay(addDays(today, -(totalDays - 1))),
    to: endOfBusinessDay(today),
    label: "",
  };
  const days = daysInRange(range);

  const [revenueRows, expenseRows] = await Promise.all([
    paidOrders(orgId, range),
    db()
      .select({ amount: expenses.amount, paidOn: expenses.paidOn, behaviour: expenseCategories.behaviour, isNonOperating: expenseCategories.isNonOperating })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(eq(expenses.orgId, orgId), gte(expenses.paidOn, days[0]!), lte(expenses.paidOn, today))),
  ]);

  const revenueByDay = new Map<string, Paise>();
  for (const row of revenueRows) {
    const day = businessDate(row.createdAt);
    // Net of GST, same rule as getProfitAndLoss above — foodCostBps below is
    // a margin figure and must not be computed against tax-inclusive revenue.
    revenueByDay.set(day, paise((revenueByDay.get(day) ?? ZERO) + paise(row.taxableTotal)));
  }

  const directByDay = new Map<string, Paise>();
  for (const row of expenseRows) {
    if (row.behaviour !== "DIRECT" || row.isNonOperating) continue;
    directByDay.set(row.paidOn, paise((directByDay.get(row.paidOn) ?? ZERO) + paise(row.amount)));
  }

  const points: FoodCostPoint[] = [];
  for (let w = 0; w < weeks; w++) {
    const bucket = days.slice(w * 7, w * 7 + 7);
    const weekRevenue = add(...bucket.map((d) => revenueByDay.get(d) ?? ZERO));
    const weekDirect = add(...bucket.map((d) => directByDay.get(d) ?? ZERO));
    points.push({
      weekStart: bucket[0]!,
      weekLabel: bucket.length > 1 ? `${shortDate(bucket[0]!)} – ${shortDate(bucket[bucket.length - 1]!)}` : shortDate(bucket[0]!),
      revenue: weekRevenue,
      directCost: weekDirect,
      foodCostBps: weekRevenue > ZERO ? ratioBps(weekDirect, weekRevenue) : null,
    });
  }
  return points;
}

export async function listCategories(orgId: string) {
  return db()
    .select()
    .from(expenseCategories)
    .where(and(eq(expenseCategories.orgId, orgId), eq(expenseCategories.isActive, true)))
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name));
}

export async function listAccounts(orgId: string) {
  return db()
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.isActive, true)))
    .orderBy(asc(accounts.name));
}

/* ------------------------------------------------------------------ */
/* P&L from the IQ daily facts (IQ-1 S9)                                */
/* ------------------------------------------------------------------ */

/** Where a report's figures came from. */
export type PnlSource = "facts" | "live";

/**
 * Why a report read live rather than from the facts:
 * - `open_day`: the range reaches today (IST). A day's facts are its nightly
 *   close; a day still trading has none that are complete.
 * - `missing_days`: some day in the range was never computed.
 * - `stale_facts`: the facts name an expense category the org no longer has.
 * - `no_fact_tables`: this database has no facts tables yet (production
 *   until owner decision dec-2).
 */
export type PnlLiveReason = "open_day" | "missing_days" | "stale_facts" | "no_fact_tables";

/** A figure's trust over the range (review I2): lowest signal grade, the signal holding it down, and its day. */
export interface PnlTrust {
  readonly revenue: MetricTrustRead;
  readonly netProfit: MetricTrustRead;
  readonly foodCostRecordedPurchases: MetricTrustRead;
  readonly foodCostRecipe: MetricTrustRead;
}

export interface ProfitAndLossReport {
  readonly pnl: ProfitAndLoss;
  readonly foodCost: FoodCostComparison;
  readonly source: PnlSource;
  /** Null on the facts path. */
  readonly liveReason: PnlLiveReason | null;
  /** Only facts are graded; null on the live path, which shows no trust badge. */
  readonly trust: PnlTrust | null;
}

/** The facts readers and the clock, injectable so the fallback can be proven without dropping tables. */
export interface PnlReportSources {
  readonly readFacts: (orgId: string, from: string, to: string) => Promise<DailyFactsRead>;
  readonly readTrust: typeof getMetricTrust;
  readonly now: () => Date;
}

const FACT_SOURCES: PnlReportSources = { readFacts: readDailyFacts, readTrust: getMetricTrust, now: () => new Date() };

/** Postgres undefined_table, on the error or the driver error Drizzle wraps. */
function isUndefinedTable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: unknown }).code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The P&L page's figures: from the daily facts when every day of the range is
 * a closed, computed day, with each figure's trust; otherwise the live
 * queries, exactly as before facts existed, with no trust. Both paths shape
 * the statement through `shapeProfitAndLoss`, and the facts are proven equal
 * to the live figures to the paisa (expenses-pnl-facts.integration.test.ts).
 */
export async function getProfitAndLossReport(orgId: string, range: DateRange, sources: PnlReportSources = FACT_SOURCES): Promise<ProfitAndLossReport> {
  const live = async (liveReason: PnlLiveReason): Promise<ProfitAndLossReport> => {
    const [pnl, foodCost] = await Promise.all([getProfitAndLoss(orgId, range), getFoodCostComparison(orgId, range)]);
    return { pnl, foodCost, source: "live", liveReason, trust: null };
  };

  const { from, to } = businessDateBounds(range);
  if (to >= businessDate(sources.now())) return live("open_day");

  let facts: DailyFactsRead;
  let trust: PnlTrust;
  try {
    facts = await sources.readFacts(orgId, from, to);
    if (facts.missingDates.length > 0) return live("missing_days");
    const [revenue, netProfit, foodCostRecordedPurchases, foodCostRecipe] = await Promise.all([
      sources.readTrust(orgId, "revenue_net", from, to),
      sources.readTrust(orgId, "net_profit", from, to),
      sources.readTrust(orgId, "food_cost_pct_recorded_purchases", from, to),
      sources.readTrust(orgId, "food_cost_pct_theoretical", from, to),
    ]);
    trust = { revenue, netProfit, foodCostRecordedPurchases, foodCostRecipe };
  } catch (error) {
    if (isUndefinedTable(error)) return live("no_fact_tables");
    throw error;
  }

  const pnl = await profitAndLossFromFacts(orgId, range, facts);
  if (pnl === null) return live("stale_facts");
  return { pnl, foodCost: foodCostFromFacts(facts), source: "facts", liveReason: null, trust };
}

/**
 * The statement from summed facts. Expense amounts are summed per category
 * across the three expense metrics, then grouped by the category's current
 * behaviour and order — the same grouping `expenseTotals` gives the live path.
 * Null when a category in the facts no longer exists.
 */
async function profitAndLossFromFacts(orgId: string, range: DateRange, facts: DailyFactsRead): Promise<ProfitAndLoss | null> {
  const amounts = new Map<string, bigint>();
  for (const metricId of ["expense_direct", "expense_operating", "expense_nonoperating"] as const) {
    for (const [categoryId, amount] of Object.entries(facts.breakdowns[metricId]?.expense_category ?? {})) {
      amounts.set(categoryId, (amounts.get(categoryId) ?? 0n) + amount);
    }
  }
  const ids = [...amounts.keys()];

  const [categories, target] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : db()
          .select({ id: expenseCategories.id, name: expenseCategories.name, behaviour: expenseCategories.behaviour, isNonOperating: expenseCategories.isNonOperating })
          .from(expenseCategories)
          .where(and(eq(expenseCategories.orgId, orgId), inArray(expenseCategories.id, ids)))
          .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name)),
    monthTarget(orgId, range),
  ]);
  if (categories.length !== ids.length) return null;

  const totals: CategoryTotal[] = categories.map((category) => ({
    categoryId: category.id,
    name: category.name,
    behaviour: category.behaviour,
    isNonOperating: category.isNonOperating,
    amount: paise(amounts.get(category.id) ?? 0n),
  }));
  const revenue = paise(facts.totals.revenue_net ?? 0n);
  return shapeProfitAndLoss(range, revenue, Number(facts.totals.orders_paid ?? 0n), totals, target);
}

function foodCostFromFacts(facts: DailyFactsRead): FoodCostComparison {
  const theoreticalCost = paise(facts.totals.food_cost_theoretical ?? 0n);
  const actualCost = paise(facts.totals.food_cost_actual ?? 0n);
  return { theoreticalCost, actualCost, varianceCost: subtract(actualCost, theoreticalCost), saleMovementCount: Number(facts.totals.sale_lines_total ?? 0n) };
}

/* ------------------------------------------------------------------ */
/* Expense writes keep the daily facts current                          */
/* ------------------------------------------------------------------ */

export interface NewExpense {
  readonly categoryId: string;
  readonly description: string;
  readonly amount: Paise;
  /** IST business date the money was paid. */
  readonly paidOn: string;
  readonly accountId: string | null;
  readonly reference: string | null;
}

/**
 * Records an expense, then refreshes the daily facts and trust for its day.
 * The caller has already validated the input and checked the category
 * belongs to `orgId`. The insert is the action; the refresh is best effort
 * and never fails it.
 */
export async function createExpense(orgId: string, input: NewExpense): Promise<{ readonly id: string }> {
  const [row] = await db()
    .insert(expenses)
    .values({ orgId, ...input })
    .returning({ id: expenses.id });
  if (!row) throw new Error("expenses: insert returned no row");
  await refreshFactsForDays(orgId, [input.paidOn]);
  return row;
}

/**
 * Rebuilds the IQ daily facts, then trust, for each IST day a committed write
 * touched — both the old and the new `paid_on` when an expense moves — so a
 * closed month's P&L, which reads facts, shows the change at once instead of
 * after the nightly run. Call after the write's transaction commits.
 *
 * Best effort: a failure (no facts tables on this database, a lock held past
 * its budget) is logged with the error's name and code only, never a value,
 * and swallowed; the nightly recompute heals the day.
 */
export async function refreshFactsForDays(orgId: string, dates: readonly string[]): Promise<void> {
  for (const date of [...new Set(dates)].sort()) {
    try {
      await recomputeDay(orgId, date);
      await computeTrustDay(orgId, date);
    } catch (error) {
      const code = typeof error === "object" && error !== null ? ((error as { code?: unknown; cause?: { code?: unknown } }).cause?.code ?? (error as { code?: unknown }).code) : undefined;
      console.warn(`expenses: facts refresh for ${date} failed (${error instanceof Error ? error.name : "unknown"}${typeof code === "string" ? ` ${code}` : ""}); the nightly recompute will retry`);
    }
  }
}
