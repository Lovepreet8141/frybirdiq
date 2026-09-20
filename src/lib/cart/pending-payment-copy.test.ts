import { describe, expect, it } from "vitest";
import { pendingPaymentNotice } from "./pending-payment-copy";

describe("pendingPaymentNotice", () => {
  it("never promises the shop 'can take payment when you collect': the kitchen waits for the money", () => {
    for (const cashEnabled of [true, false]) {
      for (const isDelivery of [true, false]) {
        const text = pendingPaymentNotice({ cashEnabled, isDelivery });
        expect(text).toContain("the kitchen starts your order only once it is paid");
        expect(text).not.toMatch(/when you collect|when your order is delivered/);
      }
    }
  });

  it("offers the counter only while the shop takes cash", () => {
    expect(pendingPaymentNotice({ cashEnabled: true, isDelivery: false })).toContain("pay at the counter");
    expect(pendingPaymentNotice({ cashEnabled: false, isDelivery: false })).not.toMatch(/counter|take payment/);
    expect(pendingPaymentNotice({ cashEnabled: false, isDelivery: false })).toBe(
      "Online payment isn't available right now, and the kitchen starts your order only once it is paid. Please call the shop.",
    );
  });

  it("a delivery order is told to call, not to come to the counter", () => {
    const text = pendingPaymentNotice({ cashEnabled: true, isDelivery: true });
    expect(text).not.toContain("counter");
    expect(text).toContain("Please call the shop");
  });
});
