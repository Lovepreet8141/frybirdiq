import "server-only";

/**
 * FRYBIRD IQ Overview — the queries.
 *
 * Every figure the Overview shows comes from here or from an existing
 * repository (`analytics`, `expenses`, `orders`). This file measures; the
 * rules that turn a measurement into a tile reading or an attention card
 * live in `src/lib/iq/overview.ts`, where they can be tested without a
 * database.
 */

import { and, asc, count, eq, gte, inArray, isNotNull, lt, max, min, sql } from "drizzle-orm";
import { db } from "@/db";
import { ingredients, inventoryMovements, orderItems, orders, organizations, payments, products, purchaseOrders, recipeVersions, wasteEntries } from "@/db/schema";
import { awaitsCounterDecision } from "@/domain/order-alert";
import type { OrderChannel } from "@/domain/order-channel";
import type { FulfilmentType, OrderStatus } from "@/domain/order-status";
import { type DateRange, addDays, businessDate, endOfBusinessDay, previousPeriod, resolveRange, startOfBusinessDay } from "@/lib/dates";
import { clampRangeToLaunch } from "@/lib/iq/launch-window";
import { type CompareKey, type CostInputs, type OpeningDate, type OverviewRange, averageOrder, isMultiDay } from "@/lib/iq/overview";
import { type Paise, ZERO, add, formatINR, paise } from "@/lib/money";
import { type DayTotal, PAID_PAYMENT_STATUSES, hasPaidPayment, periodTotals } from "./analytics";
import { type StaffOrderView, listActiveOrders } from "./orders";

/* ------------------------------------------------------------------ */
/* Settings the page needs                                             */
/* ------------------------------------------------------------------ */

export interface OverviewSettings {
  readonly kitchenCapacity: number;
  readonly opening: OpeningDate;
  readonly gstin: string | null;
}

/** Capacity and the opening date — from settings, or the first order when the owner has not set one. */
export async function getOverviewSettings(orgId: string): Promise<OverviewSettings> {
  const [org] = await db()
    .select({ kitchenCapacity: organizations.kitchenCapacity, openedOn: organizations.openedOn, gstin: organizations.gstin })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return { kitchenCapacity: 10, opening: { date: null, source: "unknown" }, gstin: null };
  if (org.openedOn) return { kitchenCapacity: org.kitchenCapacity, opening: { date: org.openedOn, source: "settings" }, gstin: org.gstin };

  const [first] = await db().select({ at: min(orders.createdAt) }).from(orders).where(eq(orders.orgId, orgId));
  return {
    kitchenCapacity: org.kitchenCapacity,
    opening: first?.at ? { date: businessDate(first.at), source: "first-order" } : { date: null, source: "unknown" },
    gstin: org.gstin,
  };
}

/* ------------------------------------------------------------------ */
/* Right now                                                           */
/* ------------------------------------------------------------------ */

export interface DrawerOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly channel: string;
  readonly items: string;
  readonly state: string;
  readonly stateTone: "late" | "ready" | "neutral";
  readonly timing: string;
  readonly amount: string;
  readonly pay: string;
  readonly payTone: "due" | "muted";
  readonly href: string;
}

export interface RightNowTile {
  readonly key: "awaiting" | "kitchen" | "ready" | "late" | "prep" | "ontime" | "load" | "payment";
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone: "neutral" | "alert" | "good";
  readonly drawerTitle: string;
  readonly drawerSub: string;
  readonly orders: readonly DrawerOrder[];
  readonly empty: string;
}

export interface RightNow {
  readonly tiles: readonly RightNowTile[];
  /** The measurements the attention rules read. */
  readonly late: { readonly count: number; readonly oldestLateMinutes: number; readonly inKitchen: number };
  readonly prep: { readonly averageMs: number | null; readonly count: number };
  readonly pendingCash: { readonly count: number; readonly total: Paise; readonly oldestMinutes: number };
}

function channelLabel(channel: OrderChannel, fulfilment: FulfilmentType, tableName: string | null): string {
  if (fulfilment === "DINE_IN") return tableName ? `Dine-in · ${tableName}` : "Dine-in";
  if (fulfilment === "DELIVERY") return "Website delivery";
  return channel === "ONLINE" ? "Website collection" : "Takeaway";
}

function itemsSummary(items: readonly { name: string; quantity: number }[]): string {
  const shown = items.slice(0, 2).map((item) => (item.quantity > 1 ? `${item.quantity}× ${item.name}` : item.name));
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(", ")} +${more} more` : shown.join(", ") || "No items";
}

function stateLabel(status: OrderStatus): string {
  switch (status) {
    case "PENDING_PAYMENT":
      return "New";
    case "PAID":
      return "Paid, not accepted";
    case "ACCEPTED":
      return "Accepted";
    case "PREPARING":
      return "Cooking";
    case "READY":
      return "Ready";
    case "OUT_FOR_DELIVERY":
      return "Out for delivery";
    case "COMPLETED":
      return "Handed over";
    default:
      return status;
  }
}

function clock(date: Date): string {
  return date.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}

function minutesBetween(from: Date, to: number): number {
  return Math.max(0, Math.round((to - from.getTime()) / 60_000));
}

function activeRow(order: StaffOrderView, now: number): DrawerOrder {
  const lateBy = order.estimatedReadyAt && order.estimatedReadyAt.getTime() < now ? minutesBetween(order.estimatedReadyAt, now) : 0;
  const placedMinutes = order.placedAt ? minutesBetween(order.placedAt, now) : null;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    channel: channelLabel(order.channel, order.fulfilment, order.tableName),
    items: itemsSummary(order.items),
    state: lateBy > 0 ? `Late ${lateBy} min` : stateLabel(order.status),
    stateTone: lateBy > 0 ? "late" : order.status === "READY" ? "ready" : "neutral",
    timing: [placedMinutes !== null ? `${placedMinutes} min in` : null, order.estimatedReadyAt ? `promised ${clock(order.estimatedReadyAt)}` : "no promise"].filter(Boolean).join(" · "),
    amount: formatINR(order.grandTotal, "whole"),
    pay: order.isPaid ? "Paid" : "Unpaid · cash",
    payTone: order.isPaid ? "muted" : "due",
    href: `/app/orders?open=${order.id}`,
  };
}

interface ReadiedOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly channel: OrderChannel;
  readonly fulfilment: FulfilmentType;
  readonly status: OrderStatus;
  readonly acceptedAt: Date | null;
  readonly readyAt: Date;
  readonly estimatedReadyAt: Date | null;
  readonly grandTotal: Paise;
  readonly isPaid: boolean;
  readonly items: readonly { name: string; quantity: number }[];
}

/** Orders that reached READY since `since` — the material for prep time and on-time. */
async function readiedSince(orgId: string, since: Date): Promise<readonly ReadiedOrder[]> {
  const rows = await db()
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      channel: orders.channel,
      fulfilment: orders.fulfilment,
      status: orders.status,
      acceptedAt: orders.acceptedAt,
      readyAt: orders.readyAt,
      estimatedReadyAt: orders.estimatedReadyAt,
      grandTotal: orders.grandTotal,
    })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), isNotNull(orders.readyAt), gte(orders.readyAt, since), sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`))
    .orderBy(asc(orders.readyAt));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [lines, captured] = await Promise.all([
    db().select({ orderId: orderItems.orderId, name: orderItems.productName, quantity: orderItems.quantity }).from(orderItems).where(inArray(orderItems.orderId, ids)),
    db().select({ orderId: payments.orderId }).from(payments).where(and(inArray(payments.orderId, ids), inArray(payments.status, PAID_PAYMENT_STATUSES))),
  ]);
  const paid = new Set(captured.map((row) => row.orderId));
  return rows.map((row) => ({
    ...row,
    readyAt: row.readyAt!,
    grandTotal: paise(row.grandTotal),
    isPaid: paid.has(row.id),
    items: lines.filter((line) => line.orderId === row.id).map((line) => ({ name: line.name, quantity: line.quantity })),
  }));
}

function readiedRow(order: ReadiedOrder, now: number): DrawerOrder {
  const missedBy = order.estimatedReadyAt && order.readyAt.getTime() > order.estimatedReadyAt.getTime() ? minutesBetween(order.estimatedReadyAt, order.readyAt.getTime()) : 0;
  const prep = order.acceptedAt ? Math.round((order.readyAt.getTime() - order.acceptedAt.getTime()) / 60_000) : null;
  const agoMinutes = minutesBetween(order.readyAt, now);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    channel: channelLabel(order.channel, order.fulfilment, null),
    items: itemsSummary(order.items),
    state: missedBy > 0 ? `Missed by ${missedBy} min` : stateLabel(order.status),
    stateTone: missedBy > 0 ? "late" : order.status === "READY" ? "ready" : "neutral",
    timing: [prep !== null ? `accept → ready ${prep} min` : "no accept time", agoMinutes < 60 ? `ready ${agoMinutes} min ago` : `ready ${Math.round(agoMinutes / 60)}h ago`].join(" · "),
    amount: formatINR(order.grandTotal, "whole"),
    pay: order.isPaid ? "Paid" : "Unpaid · cash",
    payTone: order.isPaid ? "muted" : "due",
    href: `/app/orders?open=${order.id}`,
  };
}

export async function getRightNow(orgId: string, kitchenCapacity: number, now: number): Promise<RightNow> {
  const today = businessDate(new Date(now));
  const [active, readiedToday] = await Promise.all([listActiveOrders(orgId), readiedSince(orgId, startOfBusinessDay(today))]);

  const awaiting = active.filter(awaitsCounterDecision);
  const kitchen = active.filter((order) => order.status === "ACCEPTED" || order.status === "PREPARING");
  const ready = active.filter((order) => order.status === "READY");
  const late = active
    .filter((order) => order.estimatedReadyAt !== null && order.estimatedReadyAt.getTime() < now && ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"].includes(order.status))
    .sort((a, b) => a.estimatedReadyAt!.getTime() - b.estimatedReadyAt!.getTime());
  const pending = active.filter((order) => !order.isPaid && (order.status === "READY" || order.status === "OUT_FOR_DELIVERY"));

  const lastHour = readiedToday.filter((order) => order.readyAt.getTime() >= now - 3_600_000 && order.acceptedAt !== null);
  const prepAverageMs = lastHour.length > 0 ? lastHour.reduce((sum, order) => sum + (order.readyAt.getTime() - order.acceptedAt!.getTime()), 0) / lastHour.length : null;

  const promised = readiedToday.filter((order) => order.estimatedReadyAt !== null);
  const hits = promised.filter((order) => order.readyAt.getTime() <= order.estimatedReadyAt!.getTime());
  const misses = promised.filter((order) => order.readyAt.getTime() > order.estimatedReadyAt!.getTime());

  const oldestKitchenMinutes = kitchen.reduce((oldest, order) => Math.max(oldest, order.placedAt ? minutesBetween(order.placedAt, now) : 0), 0);
  const oldestLateMinutes = late[0]?.estimatedReadyAt ? minutesBetween(late[0].estimatedReadyAt, now) : 0;
  const pendingTotal = add(...pending.map((order) => order.grandTotal));
  const oldestPendingMinutes = pending.reduce((oldest, order) => Math.max(oldest, order.placedAt ? minutesBetween(order.placedAt, now) : 0), 0);
  const loadPct = kitchenCapacity > 0 ? Math.round((kitchen.length / kitchenCapacity) * 100) : null;
  const onTime = promised.length > 0 ? `${((hits.length / promised.length) * 100).toFixed(1)}%` : "—";

  const tiles: RightNowTile[] = [
    {
      key: "awaiting",
      label: "AWAITING DECISION",
      value: String(awaiting.length),
      sub: awaiting.length === 0 ? "Nothing waiting on the counter" : "Website orders the counter has not accepted",
      tone: awaiting.length > 0 ? "alert" : "neutral",
      drawerTitle: "Awaiting decision",
      drawerSub: "Website orders the counter has not accepted or turned down",
      orders: awaiting.map((order) => activeRow(order, now)),
      empty: "Nothing waiting. Counter orders are accepted as they are rung up; website orders need a tap.",
    },
    {
      key: "kitchen",
      label: "IN THE KITCHEN",
      value: String(kitchen.length),
      sub: kitchen.length === 0 ? "No tickets open" : `Accepted and cooking · oldest ${oldestKitchenMinutes} min`,
      tone: "neutral",
      drawerTitle: "In the kitchen",
      drawerSub: `${kitchen.length} ${kitchen.length === 1 ? "ticket" : "tickets"} accepted or cooking`,
      orders: kitchen.map((order) => activeRow(order, now)),
      empty: "No open tickets.",
    },
    {
      key: "ready",
      label: "READY",
      value: String(ready.length),
      sub: "Waiting on rider or customer",
      tone: "neutral",
      drawerTitle: "Ready",
      drawerSub: "Plated or bagged, waiting on a rider or the customer",
      orders: ready.map((order) => activeRow(order, now)),
      empty: "Nothing waiting to go out.",
    },
    {
      key: "late",
      label: "LATE",
      value: String(late.length),
      sub: late.length === 0 ? "Nothing past its promised time" : `Past the promised time · oldest ${oldestLateMinutes} min`,
      tone: late.length > 0 ? "alert" : "good",
      drawerTitle: "Late orders",
      drawerSub: "Past the promised time — sorted by how late",
      orders: late.map((order) => activeRow(order, now)),
      empty: "Nothing is late.",
    },
    {
      key: "prep",
      label: "AVG PREP TIME",
      value: prepAverageMs === null ? "—" : formatMs(prepAverageMs),
      sub: lastHour.length === 0 ? "No orders ready in the last hour" : `Accept → ready · last hour · ${lastHour.length} ${lastHour.length === 1 ? "order" : "orders"}`,
      tone: "neutral",
      drawerTitle: "Prep time, last hour",
      drawerSub: `Accept → ready for the ${lastHour.length} ${lastHour.length === 1 ? "order" : "orders"} ready in the last hour`,
      orders: lastHour.map((order) => readiedRow(order, now)),
      empty: "No order has gone accept → ready in the last hour.",
    },
    {
      key: "ontime",
      label: "ON-TIME TODAY",
      value: onTime,
      sub: promised.length === 0 ? "No promised orders ready yet" : `${hits.length} of ${promised.length} inside promise`,
      tone: promised.length === 0 ? "neutral" : misses.length === 0 ? "good" : "neutral",
      drawerTitle: "On-time today",
      drawerSub: promised.length === 0 ? "Counts only orders that carried a promised time" : `${hits.length} of ${promised.length} orders were ready inside their promise. ${misses.length === 0 ? "No misses." : `The ${misses.length} ${misses.length === 1 ? "miss" : "misses"}:`}`,
      orders: misses.map((order) => readiedRow(order, now)),
      empty: "Every promised order was ready in time.",
    },
    {
      key: "load",
      label: "KITCHEN LOAD",
      value: loadPct === null ? "—" : `${loadPct}%`,
      sub: `${kitchen.length} ${kitchen.length === 1 ? "ticket" : "tickets"} · capacity ${kitchenCapacity}`,
      tone: loadPct !== null && loadPct > 100 ? "alert" : "neutral",
      drawerTitle: "Kitchen load",
      drawerSub: `${kitchen.length} open ${kitchen.length === 1 ? "ticket" : "tickets"} against a capacity of ${kitchenCapacity} · set under Restaurant settings`,
      orders: kitchen.map((order) => activeRow(order, now)),
      empty: "No open tickets.",
    },
    {
      key: "payment",
      label: "PAYMENT PENDING",
      value: formatINR(pendingTotal, "whole"),
      sub: `${pending.length} cash ${pending.length === 1 ? "order" : "orders"} unsettled`,
      tone: pending.length > 0 ? "alert" : "neutral",
      drawerTitle: "Payment pending",
      drawerSub: `${formatINR(pendingTotal, "whole")} across ${pending.length} cash ${pending.length === 1 ? "order" : "orders"} out with a rider or ready at the counter, not yet settled in the till`,
      orders: pending.map((order) => activeRow(order, now)),
      empty: "Every order that has left the kitchen is paid.",
    },
  ];

  return {
    tiles,
    late: { count: late.length, oldestLateMinutes, inKitchen: kitchen.length },
    prep: { averageMs: prepAverageMs, count: lastHour.length },
    pendingCash: { count: pending.length, total: pendingTotal, oldestMinutes: oldestPendingMinutes },
  };
}

function formatMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/* ------------------------------------------------------------------ */
/* KPI row: the range and its comparison                               */
/* ------------------------------------------------------------------ */

export interface RangeComparison {
  readonly current: DayTotal;
  readonly comparison: DayTotal | null;
  readonly currentAverage: Paise;
  readonly comparisonAverage: Paise | null;
  readonly window: DateRange;
}

function windowFor(range: OverviewRange, now: Date): DateRange {
  const today = businessDate(now);
  if (range === "today") return { from: startOfBusinessDay(today), to: now, label: "Today" };
  return resolveRange(range, now);
}

/** The same slice of a different day — 00:00 to *now o'clock* of that day, not the whole of it. */
function sameSliceOf(date: string, elapsedMs: number): DateRange {
  const from = startOfBusinessDay(date);
  return { from, to: new Date(from.getTime() + elapsedMs), label: date };
}

function shifted(range: DateRange, days: number): DateRange {
  const ms = days * 86_400_000;
  return { from: new Date(range.from.getTime() - ms), to: new Date(range.to.getTime() - ms), label: range.label };
}

async function averageOf(orgId: string, windows: readonly DateRange[]): Promise<DayTotal> {
  const totals = await Promise.all(windows.map((window) => periodTotals(orgId, window)));
  const revenue = totals.reduce<Paise>((sum, total) => add(sum, total.revenue), ZERO);
  const orderCount = totals.reduce((sum, total) => sum + total.orders, 0);
  return { revenue: paise(revenue / BigInt(windows.length)), orders: Math.round(orderCount / windows.length) };
}

/**
 * The range's totals and the comparison's, measured the same way. "To the
 * same hour" for today, whole days for anything already finished — so a
 * morning is never measured against a full day and read as a collapse.
 *
 * `analytics-start-date`: the CURRENT window is clamped to the org's Opening date by default (`openedOn`,
 * unless `includePreLaunch`) — "Last 30 days" three days after a real go-live shows three real days, not
 * thirty days of test data. The comparison baseline needs no separate clamp: `compareOptions` (`src/lib/iq/
 * overview.ts`) already refuses to offer a comparison that needs more history than the shop has had since
 * opening, so `compare` here is never a key whose baseline would reach before the Opening date.
 */
export async function getRangeComparison(orgId: string, range: OverviewRange, compare: CompareKey | null, now: Date, openedOn: string | null = null, includePreLaunch = false): Promise<RangeComparison> {
  const window = clampRangeToLaunch(windowFor(range, now), openedOn, includePreLaunch);
  const today = businessDate(now);
  const current = await periodTotals(orgId, window);

  let comparison: DayTotal | null = null;
  if (compare) {
    if (isMultiDay(range)) {
      if (compare === "prev") comparison = await periodTotals(orgId, previousPeriod(window));
      else if (compare === "avg4") comparison = await averageOf(orgId, [7, 14, 21, 28].map((days) => shifted(window, days)));
    } else if (range === "today") {
      const elapsed = now.getTime() - window.from.getTime();
      if (compare === "lw") comparison = await periodTotals(orgId, sameSliceOf(addDays(today, -7), elapsed));
      else if (compare === "yd") comparison = await periodTotals(orgId, sameSliceOf(addDays(today, -1), elapsed));
      else if (compare === "avg4") comparison = await averageOf(orgId, [7, 14, 21, 28].map((days) => sameSliceOf(addDays(today, -days), elapsed)));
    } else {
      const day = addDays(today, -1);
      const whole = (date: string): DateRange => ({ from: startOfBusinessDay(date), to: endOfBusinessDay(date), label: date });
      if (compare === "lw") comparison = await periodTotals(orgId, whole(addDays(day, -7)));
      else if (compare === "yd") comparison = await periodTotals(orgId, whole(addDays(day, -1)));
      else if (compare === "avg4") comparison = await averageOf(orgId, [7, 14, 21, 28].map((days) => whole(addDays(day, -days))));
    }
  }

  return {
    current,
    comparison,
    currentAverage: averageOrder(current.revenue, current.orders),
    comparisonAverage: comparison ? averageOrder(comparison.revenue, comparison.orders) : null,
    window,
  };
}

/** Orders in the window the revenue figures leave out, so the page can say so with real counts. */
export async function countExcluded(orgId: string, window: DateRange): Promise<{ cancelled: number; refunded: number }> {
  const rows = await db()
    .select({ status: orders.status, n: count() })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, window.from), lt(orders.createdAt, window.to), sql`${orders.status} IN ('CANCELLED', 'FAILED', 'REFUNDED')`))
    .groupBy(orders.status);
  const of = (status: string) => rows.find((row) => row.status === status)?.n ?? 0;
  return { cancelled: of("CANCELLED") + of("FAILED"), refunded: of("REFUNDED") };
}

/* ------------------------------------------------------------------ */
/* Menu: when each product last sold                                   */
/* ------------------------------------------------------------------ */

export interface ProductLastSale {
  readonly name: string;
  readonly slug: string;
  readonly price: Paise;
  readonly lastSoldAt: Date | null;
  /** Days since the last paid sale; null when it has never sold. */
  readonly days: number | null;
  readonly isHighestPriced: boolean;
}

/** Every live product with the date of its last paid sale — the material for "not selling". */
export async function productLastSales(orgId: string, now: Date): Promise<readonly ProductLastSale[]> {
  const rows = await db()
    .select({
      name: products.name,
      slug: products.slug,
      price: products.basePrice,
      // Explicit aliases: inside a single-table select Drizzle renders column
      // references unqualified, so `orders.id` and `products.id` would both
      // come out as "id" and the subquery would be ambiguous.
      lastSoldAt: sql<Date | null>`(
        SELECT max(o.created_at) FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE ${hasPaidPayment(sql`o.id`)}
          AND (oi.product_id = products.id OR (oi.product_id IS NULL AND oi.product_name = products.name))
          AND o.org_id = ${orgId}
          AND o.status NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')
      )`,
    })
    .from(products)
    .where(and(eq(products.orgId, orgId), eq(products.isActive, true), eq(products.status, "PUBLISHED")))
    .orderBy(asc(products.position), asc(products.name));

  const top = rows.reduce<bigint>((best, row) => (row.price > best ? row.price : best), 0n);
  return rows.map((row) => {
    const lastSoldAt = row.lastSoldAt ? new Date(row.lastSoldAt) : null;
    return {
      name: row.name,
      slug: row.slug,
      price: paise(row.price),
      lastSoldAt,
      days: lastSoldAt ? Math.floor((now.getTime() - lastSoldAt.getTime()) / 86_400_000) : null,
      isHighestPriced: row.price === top && top > 0n,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Cost inputs                                                         */
/* ------------------------------------------------------------------ */

/** How many of each cost input exist at all — the "n of 5 connected" on the missing KPI cards. */
export async function getCostInputs(orgId: string): Promise<CostInputs> {
  const [[purchases], [stockCounts], [waste], [recipeCosts], [packaging]] = await Promise.all([
    db().select({ n: count() }).from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)),
    // A stock count is recorded as an ADJUSTMENT (architecture D5) — there is no separate count type.
    db().select({ n: count() }).from(inventoryMovements).where(and(eq(inventoryMovements.orgId, orgId), eq(inventoryMovements.type, "ADJUSTMENT"))),
    db().select({ n: count() }).from(wasteEntries).where(eq(wasteEntries.orgId, orgId)),
    db().select({ n: count() }).from(recipeVersions).where(eq(recipeVersions.orgId, orgId)),
    db().select({ n: count() }).from(ingredients).where(and(eq(ingredients.orgId, orgId), eq(ingredients.isPackaging, true), sql`${ingredients.costPerBaseUnit} > 0`)),
  ]);
  return {
    purchases: purchases?.n ?? 0,
    stockCounts: stockCounts?.n ?? 0,
    waste: waste?.n ?? 0,
    recipeCosts: recipeCosts?.n ?? 0,
    packaging: packaging?.n ?? 0,
  };
}

/** The latest completed-order timestamp — "POS synced" on the header is a fact about the data, not a socket. */
export async function latestOrderActivity(orgId: string): Promise<Date | null> {
  const [row] = await db().select({ at: max(orders.updatedAt) }).from(orders).where(eq(orders.orgId, orgId));
  return row?.at ?? null;
}
