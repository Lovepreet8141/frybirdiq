import "server-only";

/**
 * Money out, and the profit-and-loss that becomes possible once it is recorded.
 *
 * Revenue is not stored here. It comes from `orders`, the same source the
 * dashboard reads, on the same "a captured payment or it is not revenue" rule.
 * Keeping a second revenue figure in an expenses table would let the P&L and
 * the dashboard disagree, and the first refund would make them.
 */

import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { accounts, expenseCategories, expenses, orders, payments, targets } from "@/db/schema";
import { type DateRange } from "@/lib/dates";
import { type Bps, type Paise, ZERO, paise } from "@/lib/money";
import { profit, type ProfitResult } from "@/lib/iq/profit";

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

/** Revenue that actually arrived in a period, on the dashboard's own rule. */
export async function paidRevenue(orgId: string, range: DateRange): Promise<Paise> {
  const rows = await db()
    .select({ total: sql<string>`coalesce(sum(${orders.grandTotal}), 0)` })
    .from(orders)
    .innerJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, "CAPTURED")))
    .where(
      and(
        eq(orders.orgId, orgId),
        gte(orders.createdAt, range.from),
        lt(orders.createdAt, range.to),
        sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`,
      ),
    );
  return paise(BigInt(rows[0]?.total ?? "0"));
}

/** Paid orders in a period — the denominator for an average, and for units. */
export async function paidOrderCount(orgId: string, range: DateRange): Promise<number> {
  const rows = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .innerJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, "CAPTURED")))
    .where(
      and(
        eq(orders.orgId, orgId),
        gte(orders.createdAt, range.from),
        lt(orders.createdAt, range.to),
        sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`,
      ),
    );
  return rows[0]?.n ?? 0;
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
  const [revenue, orderCount, totals, target] = await Promise.all([
    paidRevenue(orgId, range),
    paidOrderCount(orgId, range),
    expenseTotals(orgId, range),
    monthTarget(orgId, range),
  ]);

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
