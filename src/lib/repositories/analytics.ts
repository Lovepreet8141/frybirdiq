import "server-only";

/**
 * The numbers behind FRYBIRD IQ. BUILD-PLAN.md §38, §39, §40.
 *
 * §39: "Business metrics should come from authoritative transaction data, not
 * only analytics events." Every figure here is read from orders and payments.
 * Nothing is derived from a tracking pixel.
 *
 * Revenue means money that actually arrived: an order counts once it has a
 * captured payment. An order sitting unpaid is pipeline, not takings, and is
 * reported separately so a good-looking day cannot be built out of orders
 * nobody has paid for.
 */

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, payments } from "@/db/schema";
import { type Paise, ZERO, add, paise, ratioBps } from "@/lib/money";
import { type DateRange, businessDate, daysInRange, previousPeriod } from "@/lib/dates";
import { TERMINAL_STATUSES } from "@/domain/order-status";

export interface Metric {
  readonly value: Paise;
  /** Same metric over the preceding period of equal length. */
  readonly previous: Paise;
  /** Change in basis points. Null when there is no base to compare against. */
  readonly changeBps: number | null;
}

export interface CountMetric {
  readonly value: number;
  readonly previous: number;
  readonly changeBps: number | null;
}

export interface TopProduct {
  readonly name: string;
  readonly quantity: number;
  readonly revenue: Paise;
}

export interface DayPoint {
  readonly date: string;
  readonly revenue: Paise;
  readonly orders: number;
}

export interface Dashboard {
  readonly range: DateRange;
  readonly revenue: Metric;
  readonly orders: CountMetric;
  readonly averageOrder: Metric;
  /** Orders taken but not yet paid for. Pipeline, not takings. */
  readonly openOrders: number;
  readonly openValue: Paise;
  readonly collection: { orders: number; revenue: Paise };
  readonly delivery: { orders: number; revenue: Paise };
  readonly topProducts: readonly TopProduct[];
  readonly series: readonly DayPoint[];
  /** True when the range has produced nothing at all. */
  readonly empty: boolean;
}

function changeBps(current: bigint | number, previous: bigint | number): number | null {
  const now = typeof current === "bigint" ? current : BigInt(Math.round(current));
  const before = typeof previous === "bigint" ? previous : BigInt(Math.round(previous));
  // A rise from nothing is not a percentage. Reporting "+∞%" or "+100%" from a
  // zero base is a number that means nothing; the dashboard shows the figure
  // and no delta instead.
  if (before === 0n) return null;
  return ratioBps((now - before) as Paise, before as Paise);
}

/** Orders in a window that have been paid for. */
async function paidOrders(orgId: string, range: DateRange) {
  return db()
    .select({
      id: orders.id,
      grandTotal: orders.grandTotal,
      fulfilment: orders.fulfilment,
      placedAt: orders.placedAt,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .innerJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, "CAPTURED")))
    .where(
      and(
        eq(orders.orgId, orgId),
        gte(orders.createdAt, range.from),
        lt(orders.createdAt, range.to),
        // A refunded or cancelled order is not revenue, whatever was captured.
        sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`,
      ),
    );
}

export async function getDashboard(orgId: string, range: DateRange): Promise<Dashboard> {
  const before = previousPeriod(range);

  const [current, prior] = await Promise.all([paidOrders(orgId, range), paidOrders(orgId, before)]);

  const revenueOf = (rows: typeof current) => add(...rows.map((row) => paise(row.grandTotal)));
  const revenue = revenueOf(current);
  const priorRevenue = revenueOf(prior);

  const mean = (total: Paise, count: number) => (count === 0 ? ZERO : ((total / BigInt(count)) as Paise));
  const aov = mean(revenue, current.length);
  const priorAov = mean(priorRevenue, prior.length);

  // Open orders: taken, not terminal, not paid. Counted now rather than over
  // the range, because "what is still owed" is a question about this moment.
  const open = await db()
    .select({ id: orders.id, grandTotal: orders.grandTotal })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED', 'COMPLETED')`,
        sql`NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = ${orders.id} AND p.status = 'CAPTURED')`,
      ),
    );

  const byFulfilment = (kind: "DELIVERY" | "TAKEAWAY" | "DINE_IN") => {
    const rows = current.filter((row) => row.fulfilment === kind);
    return { orders: rows.length, revenue: revenueOf(rows) };
  };

  const delivery = byFulfilment("DELIVERY");
  const collectionRows = current.filter((row) => row.fulfilment !== "DELIVERY");
  const collection = { orders: collectionRows.length, revenue: revenueOf(collectionRows) };

  // Top products, by revenue rather than by count: twenty ₹20 sauces are not a
  // bigger contributor than three ₹300 buckets, and a menu decision made on
  // count alone would drop the wrong thing.
  const ids = current.map((row) => row.id);
  const items = ids.length > 0 ? await db().select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [];

  const byProduct = new Map<string, { quantity: number; revenue: Paise }>();
  for (const item of items) {
    const found = byProduct.get(item.productName) ?? { quantity: 0, revenue: ZERO };
    byProduct.set(item.productName, {
      quantity: found.quantity + item.quantity,
      revenue: (found.revenue + paise(item.lineTotal)) as Paise,
    });
  }

  const topProducts = [...byProduct.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => (b.revenue === a.revenue ? b.quantity - a.quantity : b.revenue > a.revenue ? 1 : -1))
    .slice(0, 6);

  const byDay = new Map<string, { revenue: Paise; orders: number }>();
  for (const row of current) {
    const day = businessDate(row.createdAt);
    const found = byDay.get(day) ?? { revenue: ZERO, orders: 0 };
    byDay.set(day, { revenue: (found.revenue + paise(row.grandTotal)) as Paise, orders: found.orders + 1 });
  }

  const series = daysInRange(range).map((date) => ({
    date,
    revenue: byDay.get(date)?.revenue ?? ZERO,
    orders: byDay.get(date)?.orders ?? 0,
  }));

  return {
    range,
    revenue: { value: revenue, previous: priorRevenue, changeBps: changeBps(revenue, priorRevenue) },
    orders: { value: current.length, previous: prior.length, changeBps: changeBps(current.length, prior.length) },
    averageOrder: { value: aov, previous: priorAov, changeBps: changeBps(aov, priorAov) },
    openOrders: open.length,
    openValue: add(...open.map((row) => paise(row.grandTotal))),
    collection,
    delivery,
    topProducts,
    series,
    empty: current.length === 0 && open.length === 0,
  };
}

/** Orders placed since a moment. Drives the new-order alert. */
export async function ordersSince(orgId: string, since: Date) {
  return db()
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      grandTotal: orders.grandTotal,
      fulfilment: orders.fulfilment,
      customerName: orders.customerName,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        gte(orders.createdAt, since),
        sql`${orders.status} NOT IN (${sql.join([...TERMINAL_STATUSES].map((s) => sql`${s}`), sql`, `)})`,
      ),
    )
    .orderBy(orders.createdAt);
}
