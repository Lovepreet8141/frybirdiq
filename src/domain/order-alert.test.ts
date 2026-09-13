import { describe, expect, it } from "vitest";
import { ORDER_CHANNELS } from "./order-channel";
import { ORDER_STATUSES } from "./order-status";
import { awaitsCounterDecision, isOnlineOrder } from "./order-alert";

describe("awaitsCounterDecision — what may open the new-order pop-up or sound the alarm", () => {
  it("is an undecided online order", () => {
    expect(awaitsCounterDecision({ channel: "ONLINE", status: "PENDING_PAYMENT" })).toBe(true);
    expect(awaitsCounterDecision({ channel: "ONLINE", status: "PAID" })).toBe(true);
  });

  it("is never an online order the counter has already dealt with", () => {
    for (const status of ORDER_STATUSES.filter((s) => s !== "PENDING_PAYMENT" && s !== "PAID")) {
      expect(awaitsCounterDecision({ channel: "ONLINE", status })).toBe(false);
    }
  });

  it("is never a till order, whatever its status — a PAID till order does not match", () => {
    for (const channel of ORDER_CHANNELS.filter((c) => c !== "ONLINE")) {
      for (const status of ORDER_STATUSES) {
        expect(awaitsCounterDecision({ channel, status })).toBe(false);
      }
    }
    expect(awaitsCounterDecision({ channel: "TAKEAWAY", status: "PAID" })).toBe(false);
    expect(awaitsCounterDecision({ channel: "DINE_IN", status: "PENDING_PAYMENT" })).toBe(false);
  });

  it("treats only ONLINE as away from the counter", () => {
    expect(isOnlineOrder("ONLINE")).toBe(true);
    expect(isOnlineOrder("DINE_IN")).toBe(false);
    expect(isOnlineOrder("TAKEAWAY")).toBe(false);
  });
});
