import { describe, expect, it } from "vitest";
import { orderPaymentState } from "./order-payment-state";

describe("orderPaymentState", () => {
  it("is UNPAID with no payment, or only payments that never captured", () => {
    expect(orderPaymentState([])).toBe("UNPAID");
    expect(orderPaymentState(["PENDING"])).toBe("UNPAID");
    expect(orderPaymentState(["AUTHORIZED", "FAILED"])).toBe("UNPAID");
  });

  it("is PAID for a captured payment, ignoring failed attempts beside it", () => {
    expect(orderPaymentState(["CAPTURED"])).toBe("PAID");
    expect(orderPaymentState(["FAILED", "CAPTURED"])).toBe("PAID");
  });

  it("is PARTIALLY_REFUNDED when some money went back and some was kept", () => {
    expect(orderPaymentState(["PARTIALLY_REFUNDED"])).toBe("PARTIALLY_REFUNDED");
    expect(orderPaymentState(["CAPTURED", "REFUNDED"])).toBe("PARTIALLY_REFUNDED");
    expect(orderPaymentState(["REFUNDED", "PARTIALLY_REFUNDED"])).toBe("PARTIALLY_REFUNDED");
  });

  it("is REFUNDED only when every captured payment was refunded in full", () => {
    expect(orderPaymentState(["REFUNDED"])).toBe("REFUNDED");
    expect(orderPaymentState(["REFUNDED", "REFUNDED", "FAILED"])).toBe("REFUNDED");
  });
});
