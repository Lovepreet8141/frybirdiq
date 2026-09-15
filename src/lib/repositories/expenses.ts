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

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { accounts, expenseCategories, expenses, targets } from "@/db/schema";
import { type DateRange, addDays, businessDate, daysInRange, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates";
import { type Bps, type Paise, ZERO, add, paise, ratioBps } from "@/lib/money";
import { profit, type ProfitResult } from "@/lib/iq/profit";
import { paidOrders } from "@/lib/repositories/analytics";

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
 * Spending in a period, grouped by category.
 *
 * `paidOn` is a date column, so the range's timestamps are narrowed to dates.
 * The range is already anchored to the IST business day by lib/dates; taking
 * the ISO date of each end keeps an expense recorded on the 1st inside a month
 * that starts on the 1st, which a naive UTC comparison would not.
 */
export async function expenseTotals(orgId: string, range: DateRange): Promise<CategoryTotal[]> {
  const from = range.from.toISOString().slice(0, 10);
  const to = new Date(range.to.getTime() - 1).toISOString().slice(0, 10);

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
  const revenue = add(...paid.map((order) => paise(order.grandTotal)));
  const orderCount = paid.length;

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

/** The food-cost target for the month a range starts in, if one was set. */
export async function monthTarget(orgId: string, range: DateRange): Promise<Bps | null> {
  const month = `${range.from.toISOString().slice(0, 7)}-01`;
  const rows = await db()
    .select({ bps: targets.foodCostTargetBps })
    .from(targets)
    .where(and(eq(targets.orgId, orgId), eq(targets.month, month)))
    .limit(1);
  const value = rows[0]?.bps;
  return value === undefined || value === null ? null : (value as Bps);
}

export async function listExpenses(orgId: string, range: DateRange, limit = 100): Promise<ExpenseRow[]> {
  const from = range.from.toISOString().slice(0, 10);
  const to = new Date(range.to.getTime() - 1).toISOString().slice(0, 10);

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
    revenueByDay.set(day, paise((revenueByDay.get(day) ?? ZERO) + paise(row.grandTotal)));
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
