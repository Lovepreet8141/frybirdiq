import { describe, expect, it } from "vitest";
import { FULFILMENT_TYPES, ORDER_STATUSES, type FulfilmentType, type OrderStatus } from "@/domain/order-status";
import { type KitchenStatus, nextKitchenStatus } from "@/lib/kitchen/tickets";
import { STAFF_ADVANCE_STATUSES, staffMayAdvanceTo } from "./staff-advance";

/*
 * Mirrors `nextStep` in src/components/staff/order-card.tsx, the order card's
 * and orders board's one button. That module is a "use client" component that
 * imports server actions, React and icons, so this node suite can't import it
 * cleanly. If `nextStep` changes, change this mirror with it.
 */
function orderCardNextStep(status: OrderStatus, fulfilment: FulfilmentType): OrderStatus | null {
  switch (status) {
    case "PENDING_PAYMENT":
    case "PAID":
      return "ACCEPTED";
    case "ACCEPTED":
      return "PREPARING";
    case "PREPARING":
      return "READY";
    case "READY":
      return fulfilment === "DELIVERY" ? "OUT_FOR_DELIVERY" : "COMPLETED";
    case "OUT_FOR_DELIVERY":
      return "COMPLETED";
    default:
      return null;
  }
}

const KITCHEN_STATUSES: readonly KitchenStatus[] = ["ACCEPTED", "PREPARING", "READY"];

/** Every status a staff screen asks `advanceOrderAction` for. */
function uiRequestedStatuses(): Set<OrderStatus> {
  const requested = new Set<OrderStatus>();
  for (const status of ORDER_STATUSES) {
    for (const fulfilment of FULFILMENT_TYPES) {
      const to = orderCardNextStep(status, fulfilment);
      if (to) requested.add(to);
    }
  }
  for (const status of KITCHEN_STATUSES) {
    const next = nextKitchenStatus(status);
    if (next) requested.add(next.to);
  }
  return requested;
}

describe("staffMayAdvanceTo", () => {
  it("allows exactly the moves the orders board, order card and KDS make", () => {
    expect(new Set(STAFF_ADVANCE_STATUSES)).toEqual(uiRequestedStatuses());
    for (const to of uiRequestedStatuses()) expect(staffMayAdvanceTo(to)).toBe(true);
  });

  it("refuses CANCELLED: turning an order down goes only through rejectOrderAction", () => {
    expect(staffMayAdvanceTo("CANCELLED")).toBe(false);
  });

  it("refuses REFUNDED: only refundPayment may set it, after money has moved", () => {
    expect(staffMayAdvanceTo("REFUNDED")).toBe(false);
  });

  it("refuses PAID: only a recorded payment may set it", () => {
    expect(staffMayAdvanceTo("PAID")).toBe(false);
  });

  it("refuses statuses no staff button asks for", () => {
    expect(staffMayAdvanceTo("DRAFT")).toBe(false);
    expect(staffMayAdvanceTo("PENDING_PAYMENT")).toBe(false);
    expect(staffMayAdvanceTo("FAILED")).toBe(false);
  });
});
