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
import {
  InvalidChannelFulfilment,
  ORDER_CHANNELS,
  assertChannelFulfilment,
  fulfilmentsFor,
  isFulfilmentValid,
} from "./order-channel";
import { ROLES, authorize, can, permissionsFor } from "./permissions";
import { REJECTION_LABELS, REJECTION_MESSAGE, REJECTION_REASONS, isRejectionReason } from "./rejection";

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

  it("lets the kitchen accept an unpaid order", () => {
    // Cash on collection and cash on delivery both take the money at the end.
    // Requiring payment first would mean a collection order is not cooked
    // until the customer is at the counter, and a delivery order is never
    // cooked at all, because the cash is three kilometres away.
    expect(canTransition("PENDING_PAYMENT", "ACCEPTED", "TAKEAWAY")).toBe(true);
    expect(canTransition("PENDING_PAYMENT", "ACCEPTED", "DELIVERY")).toBe(true);
  });

  it("walks an unpaid delivery order all the way to the door", () => {
    const steps = [
      ["PENDING_PAYMENT", "ACCEPTED"],
      ["ACCEPTED", "PREPARING"],
      ["PREPARING", "READY"],
      ["READY", "OUT_FOR_DELIVERY"],
      ["OUT_FOR_DELIVERY", "COMPLETED"],
    ] as const;

    // The state machine permits the whole path; payment gates only the last
    // step, and that check lives in the order service where the payments are
    // visible.
    for (const [from, to] of steps) {
      expect(canTransition(from, to, "DELIVERY"), `${from} -> ${to}`).toBe(true);
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

describe("order channels", () => {
  it("offers exactly three, all direct", () => {
    // No aggregators in this build. Widening this enum is not how one comes
    // back — see the note in order-channel.ts.
    expect(ORDER_CHANNELS).toEqual(["DINE_IN", "TAKEAWAY", "ONLINE"]);
  });

  it("pins fulfilment for the two channels that determine it", () => {
    expect(fulfilmentsFor("DINE_IN")).toEqual(["DINE_IN"]);
    expect(fulfilmentsFor("TAKEAWAY")).toEqual(["TAKEAWAY"]);
  });

  it("lets an online order be collected or delivered", () => {
    expect(fulfilmentsFor("ONLINE")).toEqual(["TAKEAWAY", "DELIVERY"]);
  });

  it("refuses to deliver a dine-in or counter order", () => {
    expect(isFulfilmentValid("DINE_IN", "DELIVERY")).toBe(false);
    expect(isFulfilmentValid("TAKEAWAY", "DELIVERY")).toBe(false);
    expect(isFulfilmentValid("ONLINE", "DELIVERY")).toBe(true);
  });

  it("refuses to seat a takeaway order", () => {
    expect(isFulfilmentValid("TAKEAWAY", "DINE_IN")).toBe(false);
    expect(isFulfilmentValid("ONLINE", "DINE_IN")).toBe(false);
  });

  it("throws with both values named, so the log says what was attempted", () => {
    expect(() => assertChannelFulfilment("DINE_IN", "DELIVERY")).toThrow(InvalidChannelFulfilment);
    expect(() => assertChannelFulfilment("DINE_IN", "DELIVERY")).toThrow(
      /a DINE_IN order cannot be fulfilled as DELIVERY/,
    );
  });

  it("passes silently on a coherent pair", () => {
    expect(() => assertChannelFulfilment("ONLINE", "DELIVERY")).not.toThrow();
    expect(() => assertChannelFulfilment("DINE_IN", "DINE_IN")).not.toThrow();
  });

  it("allows at least one fulfilment for every channel", () => {
    for (const channel of ORDER_CHANNELS) {
      expect(fulfilmentsFor(channel).length).toBeGreaterThan(0);
    }
  });

  it("only reaches OUT_FOR_DELIVERY on a channel that can deliver", () => {
    // Ties the channel rule to the lifecycle: the one channel whose orders can
    // enter OUT_FOR_DELIVERY is the one whose fulfilment list contains it.
    for (const channel of ORDER_CHANNELS) {
      const deliverable = fulfilmentsFor(channel).includes("DELIVERY");
      const reachesDelivery = fulfilmentsFor(channel).some((fulfilment) =>
        nextStatuses("READY", fulfilment).includes("OUT_FOR_DELIVERY"),
      );
      expect(reachesDelivery).toBe(deliverable);
    }
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

  it("gives a rider only what closing a delivery needs", () => {
    expect(can(["RIDER"], "delivery.view")).toBe(true);
    expect(can(["RIDER"], "delivery.complete")).toBe(true);
  });

  it("keeps a rider out of the rest of the shop", () => {
    // A phone in a rider's pocket must not be able to move any other ticket,
    // reprice the menu, or refund anything.
    for (const permission of ["orders.update", "kitchen.update", "orders.refund", "menu.edit", "analytics.view"] as const) {
      expect(can(["RIDER"], permission), permission).toBe(false);
    }
  });

  it("lets the counter close a delivery too, for when the rider cannot", () => {
    expect(can(["CASHIER"], "delivery.complete")).toBe(true);
    expect(can(["MANAGER"], "delivery.complete")).toBe(true);
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

describe("turning an order down", () => {
  it("lets the counter decline a new order", () => {
    // Saying "we've sold out" is the counter's decision. A shop where only a
    // manager can decline leaves customers waiting for food never coming.
    expect(can(["CASHIER"], "orders.cancel")).toBe(true);
    expect(can(["MANAGER"], "orders.cancel")).toBe(true);
  });

  it("still keeps refunds away from a cashier", () => {
    // Declining an unpaid order and giving money back are different acts.
    expect(can(["CASHIER"], "orders.refund")).toBe(false);
  });

  it("keeps the kitchen and riders out of it", () => {
    expect(can(["KITCHEN"], "orders.cancel")).toBe(false);
    expect(can(["RIDER"], "orders.cancel")).toBe(false);
  });

  it("allows CANCELLED from every stage before handover", () => {
    for (const from of ["PENDING_PAYMENT", "PAID", "ACCEPTED", "PREPARING", "READY"] as const) {
      expect(canTransition(from, "CANCELLED", "TAKEAWAY"), from).toBe(true);
    }
  });

  it("refuses to cancel an order that is already finished", () => {
    expect(canTransition("COMPLETED", "CANCELLED", "TAKEAWAY")).toBe(false);
  });

  it("uses FAILED, not CANCELLED, for a delivery that could not be made", () => {
    // A rider who cannot find the door has a different outcome from a shop
    // that declined the order, and the two should not collapse into one.
    expect(canTransition("OUT_FOR_DELIVERY", "FAILED", "DELIVERY")).toBe(true);
    expect(canTransition("OUT_FOR_DELIVERY", "CANCELLED", "DELIVERY")).toBe(false);
  });

  it("gives every reason a customer-facing message", () => {
    for (const reason of REJECTION_REASONS) {
      expect(REJECTION_LABELS[reason]).toBeTruthy();
      // What the customer is told is never the internal label.
      expect(REJECTION_MESSAGE[reason]).toMatch(/\w/);
    }
  });

  it("rejects anything that is not a known reason", () => {
    expect(isRejectionReason("SOLD_OUT")).toBe(true);
    expect(isRejectionReason("BECAUSE")).toBe(false);
    expect(isRejectionReason(null)).toBe(false);
  });
});
