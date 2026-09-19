/**
 * The words on Admin → Restaurant's closed-days panel (ops-3). Pure, so the
 * sentences the owner reads about pre-orders on a closed day are tested.
 */

import { weekdayOf } from "@/lib/orders/closures";
import { formatBusinessClock } from "@/lib/orders/opening-hours";
import type { AffectedPreOrder } from "@/lib/repositories/closed-dates";

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Tue 23 Sep" from a business date. */
export function shortDate(date: string): string {
  const [, month = 1, day = 1] = date.split("-").map(Number);
  return `${SHORT_WEEKDAYS[weekdayOf(date)]} ${day} ${SHORT_MONTHS[month - 1]}`;
}

/** "Tue 23 Sep" for one day, "Tue 23 Sep – Fri 26 Sep" for a run. */
export function rangeLabel(startDate: string, endDate: string): string {
  return startDate === endDate ? shortDate(startDate) : `${shortDate(startDate)} – ${shortDate(endDate)}`;
}

/** What a pre-order row says: who, for when. Serializable, so it can cross to the client. */
export interface PreOrderRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly customerName: string | null;
  /** "Tue 23 Sep, 1:30 PM" */
  readonly when: string;
  readonly status: string;
  readonly note: string | null;
}

export function preOrderRows(affected: readonly AffectedPreOrder[]): PreOrderRow[] {
  return affected.map((order) => ({
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    when: `${shortDate(order.date)}, ${formatBusinessClock(order.scheduledFor)}`,
    status: order.status,
    note: order.note,
  }));
}

/** After adding a closed date or weekly day: what was saved, and how many pre-orders sit on it. Never says anything was cancelled. */
export function savedMessage(what: string, preOrders: number): string {
  if (preOrders === 0) return `${what} saved. No pre-orders are booked for it.`;
  const noun = preOrders === 1 ? "pre-order is" : "pre-orders are";
  return `${what} saved. ${preOrders} ${noun} already booked for it. Nothing was cancelled: they are listed below, and each one needs your decision.`;
}
