import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "./order-status";
import { statusLabel, statusTone } from "./order-status-labels";

describe("statusLabel", () => {
  it("keeps the exact words the order card has always shown", () => {
    expect(statusLabel("PENDING_PAYMENT", "DINE_IN")).toBe("New");
    expect(statusLabel("PAID", "TAKEAWAY")).toBe("Paid");
    expect(statusLabel("ACCEPTED", "DELIVERY")).toBe("Accepted");
    expect(statusLabel("PREPARING", "DINE_IN")).toBe("Cooking");
    expect(statusLabel("OUT_FOR_DELIVERY", "DELIVERY")).toBe("Out for delivery");
  });

  it("says where a ready order goes next by fulfilment", () => {
    expect(statusLabel("READY", "DELIVERY")).toBe("Ready to send");
    expect(statusLabel("READY", "TAKEAWAY")).toBe("Ready to collect");
    expect(statusLabel("READY", "DINE_IN")).toBe("Ready to collect");
  });

  it("falls back to the raw status for anything without a label", () => {
    for (const status of ["DRAFT", "COMPLETED", "CANCELLED", "FAILED", "REFUNDED"] as const) expect(statusLabel(status, "DINE_IN")).toBe(status);
  });

  it("returns a string for every status the domain defines", () => {
    for (const status of ORDER_STATUSES) expect(typeof statusLabel(status, "TAKEAWAY")).toBe("string");
  });
});

describe("statusTone", () => {
  it("reads done, needs attention, or neutral", () => {
    expect(statusTone("READY")).toBe("success");
    expect(statusTone("OUT_FOR_DELIVERY")).toBe("success");
    expect(statusTone("PENDING_PAYMENT")).toBe("warning");
    for (const status of ["PAID", "ACCEPTED", "PREPARING", "COMPLETED", "CANCELLED"] as const) expect(statusTone(status)).toBe("neutral");
  });
});
