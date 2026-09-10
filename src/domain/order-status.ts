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
  PENDING_PAYMENT: ["PAID", "FAILED", "CANCELLED"],
  PAID: ["ACCEPTED", "CANCELLED", "REFUNDED"],
  ACCEPTED: ["PREPARING", "CANCELLED", "REFUNDED"],
  PREPARING: ["READY", "CANCELLED", "REFUNDED"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED", "REFUNDED"],
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
