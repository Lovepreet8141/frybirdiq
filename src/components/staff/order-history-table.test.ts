import { describe, expect, it } from "vitest";
import { paymentLabel } from "./order-history-table";

describe("paymentLabel", () => {
  it("is Paid when captured and nothing refunded", () => {
    expect(paymentLabel({ isPaid: true, paymentState: "PAID" })).toBe("Paid");
  });

  it("is Not paid when nothing was ever captured", () => {
    expect(paymentLabel({ isPaid: false, paymentState: "UNPAID" })).toBe("Not paid");
  });

  it("is Partly refunded ahead of the plain paid read", () => {
    expect(paymentLabel({ isPaid: true, paymentState: "PARTIALLY_REFUNDED" })).toBe("Partly refunded");
  });

  it("is Refunded ahead of the plain paid read", () => {
    expect(paymentLabel({ isPaid: true, paymentState: "REFUNDED" })).toBe("Refunded");
  });
});
