import { mayOpenOrdersBoard, seesOnlyOwnDeliveries } from "./permissions";
import { describe, expect, it } from "vitest";
import {
  InvalidOrderTransition,
  ORDER_STATUSES,
  assertTransition,
  canTransition,
  foodWasCooking,
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
import { ROLES, authorize, can, canGrantRole, permissionsFor } from "./permissions";
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

  describe("foodWasCooking — reverseConsumption's credit-back vs waste decision", () => {
    it("is false for an order cancelled before or at ACCEPTED — nothing physically touched yet, even though ingredients were logically consumed at that status", () => {
      expect(foodWasCooking("DRAFT")).toBe(false);
      expect(foodWasCooking("PENDING_PAYMENT")).toBe(false);
      expect(foodWasCooking("PAID")).toBe(false);
      expect(foodWasCooking("ACCEPTED")).toBe(false);
    });

    it("is true once the kitchen has genuinely started or finished cooking", () => {
      expect(foodWasCooking("PREPARING")).toBe(true);
      expect(foodWasCooking("READY")).toBe(true);
    });

    it("is false for every terminal/other status — cancelling from one of these never reverses consumption at all (no SALE movements exist to reverse for these), but the predicate itself must not claim they were cooking", () => {
      for (const status of ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED", "FAILED", "REFUNDED"] as const) {
        expect(foodWasCooking(status)).toBe(false);
      }
    });
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

  it("stops a manager publishing a menu draft — the same OWNER/ADMIN-only gate as pricing", () => {
    expect(can(["MANAGER"], "menu.publish")).toBe(false);
    expect(can(["OWNER"], "menu.publish")).toBe(true);
    expect(can(["ADMIN"], "menu.publish")).toBe(true);
    expect(can(["CASHIER"], "menu.publish")).toBe(false);
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

  it("lets the counter mark a kitchen ticket done — one person often runs both stations (roadmap 6)", () => {
    expect(can(["CASHIER"], "kitchen.update")).toBe(true);
    // Still no run of the actual kitchen — recipes stay a KITCHEN/INVENTORY thing.
    expect(can(["CASHIER"], "recipes.edit")).toBe(false);
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

  it("keeps the payments ledger to the owner and manager — admin deliberately excluded", () => {
    expect(can(["OWNER"], "finance.view")).toBe(true);
    expect(can(["MANAGER"], "finance.view")).toBe(true);
    expect(can(["ADMIN"], "finance.view")).toBe(false);
    expect(can(["CASHIER"], "finance.view")).toBe(false);
    expect(can(["ANALYST"], "finance.view")).toBe(false);
  });

  it("recording money is a finance write, not an analytics read (roadmap 0.5)", () => {
    // The expense and target actions gate on finance.manage, not finance.view
    // — reading the till ledger and writing into the books are different
    // questions. An analyst reads the P&L; they never write into it.
    expect(can(["OWNER"], "finance.manage")).toBe(true);
    expect(can(["MANAGER"], "finance.manage")).toBe(true);
    expect(can(["ANALYST"], "finance.manage")).toBe(false);
    expect(can(["CASHIER"], "settings.manage")).toBe(false);
  });

  it("splits seeing a promotion from changing one — seeing is orders.discount, changing is promotions.manage", () => {
    // "If you may apply a code at the counter, you may see the codes" is a
    // different question from "may this person change what an order costs
    // store-wide". A cashier gets the first, not the second.
    expect(can(["CASHIER"], "orders.discount")).toBe(true);
    expect(can(["CASHIER"], "promotions.manage")).toBe(false);
    expect(can(["OWNER"], "promotions.manage")).toBe(true);
  });

  it("gives promotions.manage to owner and manager, not admin (decided 2026-09-15)", () => {
    // Moved off settings.manage ("the closest existing permission to
    // 'decides prices'") onto its own name. Run as an operational tool the
    // manager who already runs orders.discount can also run, rather than
    // folded into the OWNER/ADMIN tier menu.price and menu.publish sit in
    // — a deliberate choice, not the filter default either way.
    expect(can(["MANAGER"], "promotions.manage")).toBe(true);
    expect(can(["ADMIN"], "promotions.manage")).toBe(false);
  });

  it("gives admin finance.manage, unlike the finance.view exclusion above", () => {
    // ADMIN already holds orders.refund, the highest-trust money action in
    // this table, so being unable to record that money was spent would have
    // been an accident of finance.manage not existing, not a boundary anyone
    // intended. Decided 2026-09-15 — finance.view (the ledger read) is
    // untouched, still OWNER/MANAGER only.
    expect(can(["ADMIN"], "finance.manage")).toBe(true);
    expect(can(["ADMIN"], "finance.view")).toBe(false);
  });

  it("adding finance.view took nothing away from admin", () => {
    for (const permission of ["audit.view", "staff.manage", "orders.refund", "analytics.view", "menu.price"] as const) {
      expect(can(["ADMIN"], permission), permission).toBe(true);
    }
    expect(can(["ADMIN"], "settings.manage")).toBe(false);
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

  describe("canGrantRole — the invite screen's ceiling (roadmap 6.1)", () => {
    it("lets an owner grant anyone, including another owner", () => {
      for (const role of ROLES) {
        expect(canGrantRole(["OWNER"], role), role).toBe(true);
      }
    });

    it("stops an admin minting a fresh owner over their own head", () => {
      expect(canGrantRole(["ADMIN"], "OWNER")).toBe(false);
    });

    it("lets an admin grant another admin — the same level, not a step up", () => {
      expect(canGrantRole(["ADMIN"], "ADMIN")).toBe(true);
    });

    it("stops an admin granting manager — finance.view is MANAGER-and-OWNER only, so that would hand out money access ADMIN itself doesn't have", () => {
      expect(canGrantRole(["ADMIN"], "MANAGER")).toBe(false);
    });

    it("lets an admin grant the operational roles, which ask for nothing outside what admin already holds", () => {
      for (const role of ["CASHIER", "KITCHEN", "RIDER", "INVENTORY", "ANALYST"] as const) {
        expect(canGrantRole(["ADMIN"], role), role).toBe(true);
      }
    });

    it("checks the real permission sets, not a hand-authored rank — a cashier can't grant kitchen despite outranking it on paper", () => {
      // CASHIER holds kitchen.update (roadmap 6) but not recipes.view or
      // inventory.waste, both of which KITCHEN has — so the grant is refused
      // even though nothing here says "CASHIER < KITCHEN" directly.
      expect(canGrantRole(["CASHIER"], "KITCHEN")).toBe(false);
    });

    it("unions permissions across every role the actor holds, same as can()", () => {
      // KITCHEN alone is missing purchasing.manage and recipes.edit, both of
      // which INVENTORY needs — but a person holding both roles has them.
      expect(canGrantRole(["KITCHEN"], "INVENTORY")).toBe(false);
      expect(canGrantRole(["KITCHEN", "INVENTORY"], "INVENTORY")).toBe(true);
    });
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

describe("rider assignment (roadmap 6.3)", () => {
  it("only OWNER, ADMIN and MANAGER may assign a rider; a rider, a cashier and the rest may not", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER"] as const) expect(can([role], "delivery.assign"), role).toBe(true);
    for (const role of ["CASHIER", "KITCHEN", "RIDER", "INVENTORY", "ANALYST"] as const) expect(can([role], "delivery.assign"), role).toBe(false);
  });

  it("a rider sees only their own deliveries; anyone who can update orders at the counter sees all", () => {
    expect(seesOnlyOwnDeliveries(["RIDER"])).toBe(true);
    for (const role of ["OWNER", "ADMIN", "MANAGER", "CASHIER"] as const) expect(seesOnlyOwnDeliveries([role]), role).toBe(false);
    // holding a rider role does not narrow someone who also works the counter
    expect(seesOnlyOwnDeliveries(["RIDER", "CASHIER"])).toBe(false);
  });

  it("the orders board is for the counter and the kitchen: a rider (and inventory) cannot open it", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER", "CASHIER", "KITCHEN", "ANALYST"] as const) expect(mayOpenOrdersBoard([role]), role).toBe(true);
    for (const role of ["RIDER", "INVENTORY"] as const) expect(mayOpenOrdersBoard([role]), role).toBe(false);
    expect(mayOpenOrdersBoard(["RIDER", "CASHIER"])).toBe(true);
  });

  it("only a rider (and the all-permission owner/admin tier) holds delivery.take; the counter and the kitchen do not", () => {
    expect(can(["RIDER"], "delivery.take")).toBe(true);
    for (const role of ["MANAGER", "CASHIER", "KITCHEN", "INVENTORY", "ANALYST"] as const) expect(can([role], "delivery.take"), role).toBe(false);
  });
});
