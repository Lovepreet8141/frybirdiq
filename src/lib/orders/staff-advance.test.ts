import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "@/domain/order-status";
import { STAFF_ADVANCE_STATUSES, staffMayAdvanceTo } from "./staff-advance";

describe("staffMayAdvanceTo", () => {
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

  it("allows every move the orders board, order card and KDS make, plus cancelling", () => {
    for (const to of ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"] as const) {
      expect(staffMayAdvanceTo(to)).toBe(true);
    }
  });

  it("lists only real order statuses", () => {
    for (const to of STAFF_ADVANCE_STATUSES) expect(ORDER_STATUSES).toContain(to);
  });
});
