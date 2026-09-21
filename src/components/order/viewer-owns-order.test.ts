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

describe("a SIGNED remembered-contact cookie proves the orders this browser placed, not a phone number (cookie-sign-1)", () => {
  const victimOrder = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", customerPhone: "9876543210", customerEmail: null };
  const mine = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("an attacker who typed the victim's phone into their own checkout (and so holds a validly signed cookie for it) does NOT own the victim's order", () => {
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210", trusted: true, orderIds: [mine] })).toBe(false);
  });

  it("the browser that placed the order owns it, by order id", () => {
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210", trusted: true, orderIds: [victimOrder.id, mine] })).toBe(true);
  });

  it("a signed cookie with no orders owns nothing", () => {
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210", trusted: true, orderIds: [] })).toBe(false);
  });

  it("an order without an id can never be owned through a signed cookie", () => {
    expect(viewerOwnsOrder({ customerPhone: "9876543210", customerEmail: null }, null, { phone: "9876543210", trusted: true, orderIds: [victimOrder.id] })).toBe(false);
  });

  it("an unsigned (legacy) cookie behaves exactly as before while no secret is configured", () => {
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210" })).toBe(true);
    expect(viewerOwnsOrder(victimOrder, null, { phone: "9876543210", trusted: false, orderIds: [] })).toBe(true);
  });

  it("a signed-in customer's own phone or email still owns their orders whatever the cookie says", () => {
    expect(viewerOwnsOrder(victimOrder, { phone: "9876543210", email: null }, { phone: "1", trusted: true, orderIds: [] })).toBe(true);
  });

  it("rememberedPhoneFor: a signed cookie vouches for its phone only on an order it placed; an unsigned one as before", () => {
    expect(rememberedPhoneFor(victimOrder.id, { phone: "9876543210", trusted: true, orderIds: [victimOrder.id] })).toBe("9876543210");
    expect(rememberedPhoneFor(victimOrder.id, { phone: "9876543210", trusted: true, orderIds: [mine] })).toBeNull();
    expect(rememberedPhoneFor(victimOrder.id, { phone: "9876543210" })).toBe("9876543210");
    expect(rememberedPhoneFor(victimOrder.id, null)).toBeNull();
  });
});
