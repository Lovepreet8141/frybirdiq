import type { OrderStatus } from "@/domain/order-status";

type Fulfilment = "DINE_IN" | "TAKEAWAY" | "DELIVERY";

/**
 * The next step for a ticket, given where it is and how it is going out.
 *
 * Only ever one step forward. The domain state machine is the authority — this
 * decides what to label the button, and the server decides whether the move is
 * legal.
 *
 * An unpaid order can be accepted. Cash on collection and cash on delivery
 * both take the money at the end, so waiting for payment before cooking would
 * mean a collection order is not started until the customer is at the counter,
 * and a delivery order is never started at all. The exception is an order
 * waiting on an ONLINE payment: the server refuses to accept it until the money
 * is recorded (pay-ready), so it is not offered an Accept that cannot work; the
 * cash button releases it if the customer pays at the counter instead.
 */
export function nextStep(
  status: OrderStatus,
  fulfilment: Fulfilment,
  awaitingOnlinePayment = false,
): { to: OrderStatus; label: string } | null {
  switch (status) {
    case "PENDING_PAYMENT":
      return awaitingOnlinePayment ? null : { to: "ACCEPTED", label: "Accept" };
    case "PAID":
      return { to: "ACCEPTED", label: "Accept" };
    case "ACCEPTED":
      return { to: "PREPARING", label: "Start cooking" };
    case "PREPARING":
      return { to: "READY", label: "Mark ready" };
    case "READY":
      // Only a delivery goes out; everything else is handed over and done.
      return fulfilment === "DELIVERY"
        ? { to: "OUT_FOR_DELIVERY", label: "Send out" }
        : { to: "COMPLETED", label: "Complete" };
    case "OUT_FOR_DELIVERY":
      return { to: "COMPLETED", label: "Delivered" };
    default:
      return null;
  }
}
