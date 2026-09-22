import { describe, expect, it } from "vitest";
import { greetingName, redactReceiptCustomerForViewer, rememberedPhoneFor, viewerOwnsOrder } from "./viewer-owns-order";

const order = { customerPhone: "9876543210", customerEmail: "real@customer.test" };

describe("viewerOwnsOrder", () => {
  it("owns the order when the signed-in customer's phone matches", () => {
    expect(viewerOwnsOrder(order, { phone: "9876543210", email: null }, null)).toBe(true);
  });

  it("owns the order when the signed-in customer's email matches", () => {
    expect(viewerOwnsOrder(order, { phone: null, email: "real@customer.test" }, null)).toBe(true);
  });

  it("refuses a stranger with no matching customer or cookie", () => {
    expect(viewerOwnsOrder(order, null, null)).toBe(false);
  });

  it("refuses a signed-in customer whose own phone and email both differ", () => {
    expect(viewerOwnsOrder(order, { phone: "1111111111", email: "someone@else.test" }, null)).toBe(false);
  });

  it("never matches on two nulls — an order with no phone on file is not owned by a customer with no phone on file", () => {
    expect(viewerOwnsOrder({ customerPhone: null, customerEmail: null }, { phone: null, email: null }, null)).toBe(false);
  });
});

describe("greetingName", () => {
  it("greets the owner by name", () => {
    expect(greetingName("Priya", true)).toBe("Priya");
  });

  it("gives a stranger with the order link no name at all", () => {
    expect(greetingName("Priya", false)).toBe(null);
  });

  it("has nothing to withhold when the order has no name on file", () => {
    expect(greetingName(null, true)).toBe(null);
  });
});

describe("redactReceiptCustomerForViewer", () => {
  const customer = { name: "Priya", phone: "9876543210", address: "12 MG Road", loyaltyTier: "gold" };

  it("passes the owner's receipt through untouched", () => {
    expect(redactReceiptCustomerForViewer(customer, true)).toEqual(customer);
  });

  it("withholds a stranger's name, phone and delivery address but keeps every other field", () => {
    expect(redactReceiptCustomerForViewer(customer, false)).toEqual({ ...customer, name: null, phone: null, address: null });
  });
});

describe("a remembered-contact cookie proves the orders this browser placed, never a bare phone number (cookie-sign-1, cookie-secret-dependency)", () => {
  const victimOrder = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", customerPhone: "9876543210", customerEmail: null };
  const mine = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("an attacker who typed the victim's phone into their own checkout (and so holds a validly signed cookie for it) does NOT own the victim's order", () => {
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210", orderIds: [mine] })).toBe(false);
  });

  it("the browser that placed the order owns it, by order id", () => {
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210", orderIds: [victimOrder.id, mine] })).toBe(true);
  });

  it("a cookie with no remembered orders owns nothing, even with the matching phone", () => {
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210", orderIds: [] })).toBe(false);
  });

  it("an order without an id can never be owned through a remembered cookie", () => {
    expect(viewerOwnsOrder({ customerPhone: "9876543210", customerEmail: null }, null, { phone: "9876543210", orderIds: [victimOrder.id] })).toBe(false);
  });

  it("there is no unsigned fallback: a bare matching phone with no order id recorded owns nothing (cookie-secret-dependency closed this)", () => {
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210", orderIds: [] })).toBe(false);
  });

  it("a signed-in customer's own phone or email still owns their orders whatever the cookie says", () => {
    expect(viewerOwnsOrder(victimOrder, { phone: "9876543210", email: null }, { phone: "1", orderIds: [] })).toBe(true);
  });

  it("rememberedPhoneFor vouches for its phone only on an order this browser is recorded as having placed", () => {
    expect(rememberedPhoneFor(victimOrder.id, { phone: "9876543210", orderIds: [victimOrder.id] })).toBe("9876543210");
    expect(rememberedPhoneFor(victimOrder.id, { phone: "9876543210", orderIds: [mine] })).toBeNull();
    expect(rememberedPhoneFor(victimOrder.id, { phone: "9876543210", orderIds: [] })).toBeNull();
    expect(rememberedPhoneFor(victimOrder.id, null)).toBeNull();
  });
});
