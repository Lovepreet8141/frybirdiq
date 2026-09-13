import { describe, expect, it } from "vitest";
import { awaitsCounterDecision } from "@/domain/order-alert";
import { canTransition, isLiveInKitchen } from "@/domain/order-status";
import { COUNTER_PLACED_STATUS } from "./counter-placement";

/**
 * A counter order is accepted at placement: the cashier who rang it up is
 * the person who would otherwise be asked to accept it. These pin the domain
 * facts `placeCounterOrder` relies on, so a change to the state machine
 * that would strand a till order in PENDING_PAYMENT fails here first.
 */
describe("counter placement", () => {
  it("lands in ACCEPTED, which the state machine allows straight from placement for both counter channels", () => {
    expect(COUNTER_PLACED_STATUS).toBe("ACCEPTED");
    expect(canTransition("PENDING_PAYMENT", COUNTER_PLACED_STATUS, "TAKEAWAY")).toBe(true);
    expect(canTransition("PENDING_PAYMENT", COUNTER_PLACED_STATUS, "DINE_IN")).toBe(true);
  });

  it("is on the kitchen display the moment it is placed", () => {
    expect(isLiveInKitchen(COUNTER_PLACED_STATUS)).toBe(true);
  });

  it("never raises the new-order alarm — not as placed, not before the cash is captured, not with a customer linked", () => {
    for (const status of ["PENDING_PAYMENT", "PAID", COUNTER_PLACED_STATUS] as const) {
      expect(awaitsCounterDecision({ channel: "TAKEAWAY", status })).toBe(false);
      expect(awaitsCounterDecision({ channel: "DINE_IN", status })).toBe(false);
    }
  });
});
