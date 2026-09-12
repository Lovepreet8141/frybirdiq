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

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, payments, products } from "@/db/schema";
import { ORDER_CHANNELS, type OrderChannel } from "@/domain/order-channel";
import { type Paise, ZERO, add, paise, ratioBps } from "@/lib/money";
import {
  type DateRange,
  addDays,
  businessDate,
  daysInRange,
  previousPeriod,
  startOfBusinessDay,
} from "@/lib/dates";

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

export function changeBps(current: bigint | number, previous: bigint | number): number | null {
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
      channel: orders.channel,
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

export interface ChannelStat {
  readonly channel: OrderChannel;
  readonly revenue: Metric;
  readonly orders: CountMetric;
  readonly averageOrder: Metric;
  /** This channel's share of the range's revenue, in basis points. */
  readonly shareBps: number;
}

export interface ChannelDayPoint {
  readonly date: string;
  readonly byChannel: Readonly<Record<OrderChannel, Paise>>;
}

export interface ChannelBreakdown {
  readonly range: DateRange;
  readonly total: Paise;
  readonly channels: readonly ChannelStat[];
  readonly series: readonly ChannelDayPoint[];
  readonly empty: boolean;
}

/**
 * Revenue, orders and average order by channel — dine-in, takeaway, the
 * website — over a range, each against the preceding period of equal
 * length. Built on the same `paidOrders` rows as everything else here, so
 * "revenue" means exactly what the Overview means by it; `orders.channel`
 * is indexed with `placedAt` for this question (`orders_channel_placed_idx`).
 */
export async function getChannelBreakdown(orgId: string, range: DateRange): Promise<ChannelBreakdown> {
  const [current, prior] = await Promise.all([paidOrders(orgId, range), paidOrders(orgId, previousPeriod(range))]);

  const revenueOf = (rows: typeof current) => add(...rows.map((row) => paise(row.grandTotal)));
  const mean = (total: Paise, count: number) => (count === 0 ? ZERO : ((total / BigInt(count)) as Paise));
  const total = revenueOf(current);

  const channels = ORDER_CHANNELS.map((channel): ChannelStat => {
    const rows = current.filter((row) => row.channel === channel);
    const before = prior.filter((row) => row.channel === channel);
    const revenue = revenueOf(rows);
    const priorRevenue = revenueOf(before);
    const aov = mean(revenue, rows.length);
    const priorAov = mean(priorRevenue, before.length);
    return {
      channel,
      revenue: { value: revenue, previous: priorRevenue, changeBps: changeBps(revenue, priorRevenue) },
      orders: { value: rows.length, previous: before.length, changeBps: changeBps(rows.length, before.length) },
      averageOrder: { value: aov, previous: priorAov, changeBps: changeBps(aov, priorAov) },
      shareBps: total === 0n ? 0 : ratioBps(revenue, total),
    };
  });

  const byDay = new Map<string, Record<OrderChannel, Paise>>();
  for (const row of current) {
    const day = businessDate(row.createdAt);
    const found = byDay.get(day) ?? { DINE_IN: ZERO, TAKEAWAY: ZERO, ONLINE: ZERO };
    found[row.channel] = add(found[row.channel], paise(row.grandTotal));
    byDay.set(day, found);
  }
  const series = daysInRange(range).map((date) => ({
    date,
    byChannel: byDay.get(date) ?? { DINE_IN: ZERO, TAKEAWAY: ZERO, ONLINE: ZERO },
  }));

  return { range, total, channels, series, empty: current.length === 0 };
}

/**
 * Orders still waiting on a yes or a no.
 *
 * Deliberately not "orders since a moment". The alert used to ask what had
 * arrived since the page loaded, which meant opening the counter screen with
 * three undecided orders on it showed nothing at all — the one moment the
 * prompt is most needed.
 *
 * An order needs a decision until the kitchen has accepted it. After that it
 * is on the board and the counter screen is the right place to follow it.
 */
export async function ordersAwaitingDecision(orgId: string) {
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
        sql`${orders.status} IN ('PENDING_PAYMENT', 'PAID')`,
      ),
    )
    .orderBy(orders.createdAt);
}

/**
 * Orders already accepted, still in flight, whose promised time has passed.
 *
 * The only "order health" signal that doesn't need a schema change or a new
 * domain concept to be real: `estimatedReadyAt` is written once at accept
 * time (§ order-status ACCEPTED) and never touched again, so comparing it to
 * now is a fact, not a forecast. Deliberately excludes PENDING_PAYMENT/PAID —
 * those have no promised time yet and are already the counter's separate
 * "awaiting decision" alert above.
 */
export async function ordersRunningLate(orgId: string) {
  return db()
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      grandTotal: orders.grandTotal,
      fulfilment: orders.fulfilment,
      customerName: orders.customerName,
      estimatedReadyAt: orders.estimatedReadyAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.orgId, orgId),
        sql`${orders.status} IN ('ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY')`,
        sql`${orders.estimatedReadyAt} IS NOT NULL`,
        lt(orders.estimatedReadyAt, sql`now()`),
      ),
    )
    .orderBy(asc(orders.estimatedReadyAt));
}

export interface DayTotal {
  readonly revenue: Paise;
  readonly orders: number;
}

/** Revenue and order count for one arbitrary window — lighter than {@link getDashboard} when neither AOV nor a product breakdown is needed. */
async function periodTotals(orgId: string, range: DateRange): Promise<DayTotal> {
  const rows = await paidOrders(orgId, range);
  return { revenue: add(...rows.map((row) => paise(row.grandTotal))), orders: rows.length };
}

export interface TodayComparison {
  readonly today: DayTotal;
  /** Yesterday, truncated to the same elapsed time as `today` — not the full day. */
  readonly yesterday: DayTotal;
  /**
   * Same weekday, one week back — the comparison a Saturday actually wants,
   * not two days ago. Also truncated to the same elapsed time as `today`.
   */
  readonly lastWeek: DayTotal;
  readonly vsYesterdayBps: number | null;
  readonly vsLastWeekBps: number | null;
  readonly ordersVsYesterdayBps: number | null;
  readonly ordersVsLastWeekBps: number | null;
}

/**
 * "How did today go" needs two comparisons at once, not one at a time behind a
 * switcher — a Monday's revenue means little next to Sunday's, but a lot next
 * to last Monday's. Always anchored to the current business day regardless of
 * which range the rest of the page is showing.
 *
 * Today is necessarily a partial day — comparing it against a *complete*
 * yesterday or last week reads as a collapse every single morning: at 4am,
 * zero orders so far against a full day of them is "-100%" and means nothing.
 * Every comparison window is truncated to the same elapsed time since the
 * business day started, so 4am is measured against 4am, not against
 * midnight-to-midnight. `changeBps` already returns `null` rather than a
 * number when the base is zero (both days quiet at this hour), which is the
 * right way to suppress a delta that has nothing to be a percentage of.
 */
export async function getTodayComparison(orgId: string): Promise<TodayComparison> {
  const now = new Date();
  const today = businessDate(now);
  const yesterday = addDays(today, -1);
  const lastWeek = addDays(today, -7);

  const elapsedMs = now.getTime() - startOfBusinessDay(today).getTime();

  /** The same window of the business day, on a different date — 00:00–04:12 yesterday, not all of it. */
  const asOfNow = (date: string): DateRange => {
    const from = startOfBusinessDay(date);
    return { from, to: new Date(from.getTime() + elapsedMs), label: date };
  };

  const [todayTotals, yesterdayTotals, lastWeekTotals] = await Promise.all([
    periodTotals(orgId, { from: startOfBusinessDay(today), to: now, label: today }),
    periodTotals(orgId, asOfNow(yesterday)),
    periodTotals(orgId, asOfNow(lastWeek)),
  ]);

  return {
    today: todayTotals,
    yesterday: yesterdayTotals,
    lastWeek: lastWeekTotals,
    vsYesterdayBps: changeBps(todayTotals.revenue, yesterdayTotals.revenue),
    vsLastWeekBps: changeBps(todayTotals.revenue, lastWeekTotals.revenue),
    ordersVsYesterdayBps: changeBps(todayTotals.orders, yesterdayTotals.orders),
    ordersVsLastWeekBps: changeBps(todayTotals.orders, lastWeekTotals.orders),
  };
}

export interface SellingGap {
  readonly name: string;
  readonly slug: string;
  readonly price: Paise;
}

/**
 * Published, active products with no paid sale in the range — the other half
 * of "what's selling", which a top-N list can never show by itself. Matched by
 * `productId`, not name: order lines snapshot the name at sale time (§51), so
 * a renamed product would otherwise show up as its own gap.
 */
export async function notSelling(orgId: string, range: DateRange, limit = 6): Promise<readonly SellingGap[]> {
  const rows = await db()
    .select({ name: products.name, slug: products.slug, price: products.basePrice })
    .from(products)
    .where(
      and(
        eq(products.orgId, orgId),
        eq(products.isActive, true),
        eq(products.status, "PUBLISHED"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${orderItems}
          INNER JOIN ${orders} ON ${orders.id} = ${orderItems.orderId}
          INNER JOIN ${payments} ON ${payments.orderId} = ${orders.id} AND ${payments.status} = 'CAPTURED'
          WHERE ${orderItems.productId} = ${products.id}
            AND ${orders.orgId} = ${orgId}
            AND ${orders.createdAt} >= ${range.from.toISOString()}
            AND ${orders.createdAt} < ${range.to.toISOString()}
            AND ${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')
        )`,
      ),
    )
    .orderBy(asc(products.position), asc(products.name))
    .limit(limit);

  return rows.map((row) => ({ name: row.name, slug: row.slug, price: paise(row.price) }));
}
