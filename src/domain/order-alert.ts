import type { OrderChannel } from "./order-channel";
import type { OrderStatus } from "./order-status";

/**
 * Which orders the counter has to be *told about*.
 *
 * The new-order pop-up and its alarm exist for orders that arrived from
 * somewhere else — the website — and are waiting on a person to say yes or
 * no. An order rung up at the till was placed by that person; it is accepted
 * at placement, and even if it were not, popping it back up in front of the
 * cashier who just took it is noise. So the source is the first test, the
 * status the second, and no status can make a till order alert.
 */

/** Placed away from the counter: the website today, an aggregator never (see CLAUDE.md "Direct orders only"). */
export function isOnlineOrder(channel: OrderChannel): boolean {
  return channel === "ONLINE";
}

/** Statuses that still need the counter's decision. */
export const UNDECIDED_STATUSES: readonly OrderStatus[] = ["PENDING_PAYMENT", "PAID"];

export function awaitsCounterDecision(order: { readonly channel: OrderChannel; readonly status: OrderStatus }): boolean {
  return isOnlineOrder(order.channel) && UNDECIDED_STATUSES.includes(order.status);
}
