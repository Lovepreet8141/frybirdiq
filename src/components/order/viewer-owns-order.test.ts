import { describe, expect, it } from "vitest";
import { viewerOwnsOrder } from "./viewer-owns-order";

const order = { customerPhone: "9876543210", customerEmail: "real@customer.test" };

describe("viewerOwnsOrder", () => {
  it("owns the order when the signed-in customer's phone matches", () => {
    expect(viewerOwnsOrder(order, { phone: "9876543210", email: null }, null)).toBe(true);
  });

  it("owns the order when the signed-in customer's email matches", () => {
    expect(viewerOwnsOrder(order, { phone: null, email: "real@customer.test" }, null)).toBe(true);
  });

  it("owns the order when the remembered checkout cookie's phone matches", () => {
    expect(viewerOwnsOrder(order, null, { phone: "9876543210" })).toBe(true);
  });

  it("refuses a stranger with no matching customer or cookie", () => {
    expect(viewerOwnsOrder(order, null, null)).toBe(false);
  });

  it("refuses a signed-in customer whose own phone and email both differ", () => {
    expect(viewerOwnsOrder(order, { phone: "1111111111", email: "someone@else.test" }, null)).toBe(false);
  });

  it("refuses a cookie holding a different phone", () => {
    expect(viewerOwnsOrder(order, null, { phone: "1111111111" })).toBe(false);
  });

  it("never matches on two nulls — an order with no phone on file is not owned by a customer with no phone on file", () => {
    expect(viewerOwnsOrder({ customerPhone: null, customerEmail: null }, { phone: null, email: null }, null)).toBe(false);
  });

  it("never matches on an empty-string cookie phone against an order with no phone on file", () => {
    expect(viewerOwnsOrder({ customerPhone: null, customerEmail: null }, null, { phone: "" })).toBe(false);
  });
});
