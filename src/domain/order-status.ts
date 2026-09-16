/**
 * Order lifecycle. BUILD-PLAN.md §16.
 *
 * The server owns valid transitions. Nothing outside this module decides
 * whether an order may move from one status to another, and no client is
 * trusted to assert a status at all — it asks for a transition and the server
 * either allows it or rejects it.
 *
 * §16 draws the lifecycle as a single line. Real orders do not move in one
 * line: a pickup order never goes out for delivery, and a cash order at the
 * counter is paid the instant it is created. So the shape here is a graph.
 */

export const ORDER_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "PAID",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
  "REFUNDED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** How the customer gets the food. Gates part of the lifecycle. */
export const FULFILMENT_TYPES = ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const;
export type FulfilmentType = (typeof FULFILMENT_TYPES)[number];

/** No transition leaves these. */
export const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "FAILED", "REFUNDED"] as const;

const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // A counter sale tendered in cash is paid at the moment it is rung up, so
  // DRAFT reaches PAID without passing through a payment wait.
  DRAFT: ["PENDING_PAYMENT", "PAID", "CANCELLED"],

  // An unpaid order can be accepted and cooked.
  //
  // Cash on collection and cash on delivery both take the money at the end —
  // at handover, or at the customer's door. Requiring payment before the
  // kitchen may start would mean a collection order is not cooked until the
  // customer is standing at the counter, and a delivery order can never be
  // cooked at all, because the cash is three kilometres away.
  //
  // What payment does gate is COMPLETED. Cooking an unpaid order is normal;
  // handing it over unpaid is giving food away. That check lives in the order
  // service, which can see the payments, rather than here.
  PENDING_PAYMENT: ["PAID", "ACCEPTED", "FAILED", "CANCELLED"],
  PAID: ["ACCEPTED", "CANCELLED", "REFUNDED"],
  ACCEPTED: ["PREPARING", "CANCELLED", "REFUNDED"],
  PREPARING: ["READY", "CANCELLED", "REFUNDED"],
  // Cancellable even once cooked: a customer who never turns up to collect is
  // a real outcome, and the food being wasted does not make the order
  // completed. A delivery that cannot be completed becomes FAILED instead —
  // see below.
  READY: ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED", "REFUNDED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "FAILED", "REFUNDED"],
  // A completed order can still be refunded — a customer comes back the next
  // day with a complaint and that has to be expressible.
  COMPLETED: ["REFUNDED"],
  CANCELLED: [],
  FAILED: [],
  REFUNDED: [],
};

export function isTerminal(status: OrderStatus): boolean {
  return (TERMINAL_STATUSES as readonly OrderStatus[]).includes(status);
}

/** The statuses reachable in one step, given how the order is being fulfilled. */
export function nextStatuses(status: OrderStatus, fulfilment: FulfilmentType): readonly OrderStatus[] {
  return TRANSITIONS[status].filter((next) => {
    // Only a delivery order goes out for delivery; a dine-in or takeaway order
    // goes straight from READY to COMPLETED when it is handed over.
    if (next === "OUT_FOR_DELIVERY") return fulfilment === "DELIVERY";
    return true;
  });
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  fulfilment: FulfilmentType,
): boolean {
  return nextStatuses(from, fulfilment).includes(to);
}

export class InvalidOrderTransition extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
    readonly fulfilment: FulfilmentType,
  ) {
    super(`order: cannot move a ${fulfilment} order from ${from} to ${to}`);
    this.name = "InvalidOrderTransition";
  }
}

/** Throws unless the transition is legal. Every status write goes through this. */
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  fulfilment: FulfilmentType,
): void {
  if (!canTransition(from, to, fulfilment)) {
    throw new InvalidOrderTransition(from, to, fulfilment);
  }
}

/** Whether the kitchen should see this order on the KDS. §21. */
export function isLiveInKitchen(status: OrderStatus): boolean {
  return status === "ACCEPTED" || status === "PREPARING" || status === "READY";
}

/**
 * Whether an order reached the point cooking had genuinely started, given
 * the status it was at right before a cancellation/rejection — the highest
 * stage it ever reached, since the state machine never moves backwards
 * (`TRANSITIONS` above).
 *
 * The one fact `reverseConsumption` (`src/lib/repositories/stock.ts`) needs
 * to decide credit-back (nothing physically touched yet) from waste (food
 * cooked, cannot un-leave the shelf) — deliberately not the same boundary
 * as consumption's own trigger (ACCEPTED, "the moment the kitchen commits").
 * `docs/INVENTORY-ARCHITECTURE.md` §7 draws this line at PREPARING; kept
 * here, pure and tested, so the one place that decision is made can't drift
 * from the one place it's read.
 */
export function foodWasCooking(statusBeforeCancelling: OrderStatus): boolean {
  return statusBeforeCancelling === "PREPARING" || statusBeforeCancelling === "READY";
}
