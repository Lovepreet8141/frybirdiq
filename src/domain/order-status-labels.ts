import type { FulfilmentType, OrderStatus } from "./order-status";

/**
 * How a status reads to staff — the words and the three-tier colour every
 * surface that shows a status badge shares (the order card, the orders
 * board, the Command Center's open-orders table), so the mapping can never
 * drift between them.
 *
 * Pure on purpose. This used to live in the "use client" order card; a
 * Server Component that imported it there received a client reference, not
 * a function, and threw at render time. Anything both a Server and a Client
 * Component call belongs in a module with no directive at all.
 */

/** Ready/out-for-delivery reads as done; an unpaid new order reads as needing attention; everything in between is neutral. */
export function statusTone(status: OrderStatus): "success" | "warning" | "neutral" {
  if (status === "READY" || status === "OUT_FOR_DELIVERY") return "success";
  if (status === "PENDING_PAYMENT") return "warning";
  return "neutral";
}

export function statusLabel(status: OrderStatus, fulfilment: FulfilmentType): string {
  switch (status) {
    case "PENDING_PAYMENT":
      return "New";
    case "PAID":
      return "Paid";
    case "ACCEPTED":
      return "Accepted";
    case "PREPARING":
      return "Cooking";
    case "READY":
      return fulfilment === "DELIVERY" ? "Ready to send" : "Ready to collect";
    case "OUT_FOR_DELIVERY":
      return "Out for delivery";
    default:
      return status;
  }
}
