import { describe, expect, it } from "vitest";
import {
  InvalidOrderTransition,
  ORDER_STATUSES,
  assertTransition,
  canTransition,
  isLiveInKitchen,
  isTerminal,
  nextStatuses,
} from "./order-status";
import { ORDER_SOURCES, isAggregator, isDirect } from "./order-source";
import { ROLES, authorize, can, permissionsFor } from "./permissions";

describe("order lifecycle", () => {
  it("walks the happy path for a delivery order", () => {
    const steps = [
      ["DRAFT", "PENDING_PAYMENT"],
      ["PENDING_PAYMENT", "PAID"],
      ["PAID", "ACCEPTED"],
      ["ACCEPTED", "PREPARING"],
      ["PREPARING", "READY"],
      ["READY", "OUT_FOR_DELIVERY"],
      ["OUT_FOR_DELIVERY", "COMPLETED"],
    ] as const;

    for (const [from, to] of steps) {
      expect(canTransition(from, to, "DELIVERY")).toBe(true);
    }
  });

  it("lets a counter cash sale reach PAID without waiting on a payment", () => {
    expect(canTransition("DRAFT", "PAID", "DINE_IN")).toBe(true);
  });

  it("never sends a takeaway order out for delivery", () => {
    expect(canTransition("READY", "OUT_FOR_DELIVERY", "TAKEAWAY")).toBe(false);
    expect(canTransition("READY", "OUT_FOR_DELIVERY", "DINE_IN")).toBe(false);
    expect(canTransition("READY", "OUT_FOR_DELIVERY", "DELIVERY")).toBe(true);
  });

  it("hands a takeaway order straight from READY to COMPLETED", () => {
    expect(canTransition("READY", "COMPLETED", "TAKEAWAY")).toBe(true);
  });

  it("refuses to skip payment", () => {
    expect(canTransition("DRAFT", "ACCEPTED", "DINE_IN")).toBe(false);
    expect(canTransition("PENDING_PAYMENT", "PREPARING", "DINE_IN")).toBe(false);
  });

  it("refuses to run backwards", () => {
    expect(canTransition("COMPLETED", "PREPARING", "DINE_IN")).toBe(false);
    expect(canTransition("READY", "ACCEPTED", "DINE_IN")).toBe(false);
  });

  it("lets a completed order still be refunded", () => {
    expect(canTransition("COMPLETED", "REFUNDED", "DINE_IN")).toBe(true);
  });

  it("leaves terminal statuses with nowhere to go", () => {
    for (const status of ["CANCELLED", "FAILED", "REFUNDED"] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(nextStatuses(status, "DELIVERY")).toEqual([]);
    }
  });

  it("throws with both statuses named, so the log says what was attempted", () => {
    expect(() => assertTransition("COMPLETED", "PREPARING", "DINE_IN")).toThrow(InvalidOrderTransition);
    expect(() => assertTransition("COMPLETED", "PREPARING", "DINE_IN")).toThrow(
      /cannot move a DINE_IN order from COMPLETED to PREPARING/,
    );
  });

  it("passes silently on a legal transition", () => {
    expect(() => assertTransition("PAID", "ACCEPTED", "DELIVERY")).not.toThrow();
  });

  it("shows the kitchen only what it is cooking", () => {
    const live = ORDER_STATUSES.filter(isLiveInKitchen);
    expect(live).toEqual(["ACCEPTED", "PREPARING", "READY"]);
  });

  it("never proposes a transition that is not allowed from that status", () => {
    for (const from of ORDER_STATUSES) {
      for (const fulfilment of ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const) {
        for (const to of nextStatuses(from, fulfilment)) {
          expect(canTransition(from, to, fulfilment)).toBe(true);
        }
      }
    }
  });
});

describe("order sources", () => {
  it("keeps Swiggy and Zomato apart", () => {
    expect(isAggregator("SWIGGY")).toBe(true);
    expect(isAggregator("ZOMATO")).toBe(true);
    expect(isAggregator("WEBSITE")).toBe(false);
  });

  it("counts website, counter, phone and kiosk as direct", () => {
    expect(ORDER_SOURCES.filter(isDirect)).toEqual(["WEBSITE", "POS", "PHONE", "KIOSK"]);
  });

  it("does not count an import as a direct order", () => {
    // Imported history is someone else's order that we are recording, and
    // counting it as direct would inflate the metric that matters most.
    expect(isDirect("IMPORT")).toBe(false);
  });
});

describe("permissions", () => {
  it("gives the owner everything", () => {
    expect(can(["OWNER"], "settings.manage")).toBe(true);
    expect(can(["OWNER"], "orders.refund")).toBe(true);
  });

  it("stops a cashier refunding, but lets them discount", () => {
    expect(can(["CASHIER"], "orders.refund")).toBe(false);
    expect(can(["CASHIER"], "orders.discount")).toBe(true);
    expect(can(["MANAGER"], "orders.refund")).toBe(true);
  });

  it("stops a manager repricing the menu, but lets them edit it", () => {
    expect(can(["MANAGER"], "menu.edit")).toBe(true);
    expect(can(["MANAGER"], "menu.price")).toBe(false);
    expect(can(["OWNER"], "menu.price")).toBe(true);
  });

  it("keeps the kitchen out of money and analytics", () => {
    expect(can(["KITCHEN"], "orders.refund")).toBe(false);
    expect(can(["KITCHEN"], "analytics.view")).toBe(false);
    expect(can(["KITCHEN"], "kitchen.update")).toBe(true);
  });

  it("keeps an analyst read-only", () => {
    expect(can(["ANALYST"], "analytics.view")).toBe(true);
    expect(can(["ANALYST"], "orders.create")).toBe(false);
    expect(can(["ANALYST"], "menu.edit")).toBe(false);
  });

  it("unions permissions across roles", () => {
    expect(can(["KITCHEN", "INVENTORY"], "purchasing.manage")).toBe(true);
    expect(can(["KITCHEN"], "purchasing.manage")).toBe(false);
  });

  it("grants nothing to an account with no role", () => {
    expect(can([], "orders.view")).toBe(false);
  });

  it("throws a named error the API layer can map to a 403", () => {
    expect(() => authorize(["CASHIER"], "orders.refund")).toThrow(/cannot orders.refund/);
    expect(() => authorize(["MANAGER"], "orders.refund")).not.toThrow();
  });

  it("gives every role at least one permission", () => {
    for (const role of ROLES) {
      expect(permissionsFor(role).length).toBeGreaterThan(0);
    }
  });
});
