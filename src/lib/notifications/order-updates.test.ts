import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import { NOTIFIABLE_STATUSES, isNotifiableStatus, orderUpdateMessage, type OrderUpdateInput } from "./order-updates";

const base: OrderUpdateInput = {
  status: "ACCEPTED",
  orderNumber: "A-101",
  customerName: "Test",
  fulfilment: "TAKEAWAY",
  payment: "COLLECT",
  total: paise(94_000n),
  link: "https://example.test/order/1",
};

describe("orderUpdateMessage", () => {
  it("covers accepted, ready and out for delivery only", () => {
    expect([...NOTIFIABLE_STATUSES]).toEqual(["ACCEPTED", "READY", "OUT_FOR_DELIVERY"]);
    expect(isNotifiableStatus("PREPARING")).toBe(false);
    expect(isNotifiableStatus("READY")).toBe(true);
  });

  it("returns null for a status nobody is told about", () => {
    expect(orderUpdateMessage({ ...base, status: "PREPARING" })).toBeNull();
  });

  it("says a pay-at-counter order is paid at the counter", () => {
    const m = orderUpdateMessage({ ...base, status: "READY" });
    expect(m?.body).toContain("Pay at the counter when you collect");
    expect(m?.body).toContain("₹940");
  });

  it("does not tell an order awaiting online payment to pay at the counter (notify-copy-1)", () => {
    const m = orderUpdateMessage({ ...base, status: "ACCEPTED", payment: "ONLINE_PENDING" });
    expect(m?.body).not.toContain("counter");
    expect(m?.body).toContain("online payment");
  });

  it("says nothing about payment for a paid order", () => {
    const m = orderUpdateMessage({ ...base, payment: "PAID" });
    expect(m?.body).not.toMatch(/pay/i);
  });

  it("asks for cash at the door on a delivery, and only delivery goes out for delivery", () => {
    const m = orderUpdateMessage({ ...base, status: "OUT_FOR_DELIVERY", fulfilment: "DELIVERY" });
    expect(m?.body).toContain("Pay the rider");
    expect(orderUpdateMessage({ ...base, status: "OUT_FOR_DELIVERY", fulfilment: "TAKEAWAY" })).toBeNull();
  });

  it("uses Indian grouping and never an exclamation mark", () => {
    const m = orderUpdateMessage({ ...base, total: paise(94_000_000n) });
    expect(m?.body).toContain("₹9,40,000");
    expect(m?.body).not.toContain("!");
  });

  it("names a template per status", () => {
    expect(orderUpdateMessage(base)?.template).toBe("order_accepted");
    expect(orderUpdateMessage({ ...base, status: "READY" })?.template).toBe("order_ready");
  });
});
