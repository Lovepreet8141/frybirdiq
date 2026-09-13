import type { OrderStatus } from "@/domain/order-status";

/**
 * The status a counter order is in the moment it is placed.
 *
 * The person ringing it up is the person who would otherwise be asked to
 * accept it, so the "accept" step is folded into placement: the order is
 * persisted (PENDING_PAYMENT, the one write path every channel shares) and
 * moved to ACCEPTED in the same idempotent placement, before the cash is
 * captured. It is on the kitchen display at once and never opens the
 * new-order pop-up. See `placeCounterOrder`.
 */
export const COUNTER_PLACED_STATUS: OrderStatus = "ACCEPTED";
