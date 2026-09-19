import { describe, expect, it } from "vitest";
import { orderingBanner, orderingControls } from "./ordering-banner";
import type { ShopOrderingState } from "./shop-hours";

const open: ShopOrderingState = { state: "open", closesAt: "23:00" };
const closed: ShopOrderingState = { state: "closedByHours", reopensAt: new Date("2026-09-21T06:00:00Z"), reopensAtLabel: "tomorrow at 11:30 AM" };
const pausedTimed: ShopOrderingState = { state: "paused", mode: "UNTIL_NEXT_OPENING", pausedAt: new Date(), reopensAt: new Date(), reopensAtLabel: "today at 11:30 AM", withinHours: false };
const pausedManual: ShopOrderingState = { state: "paused", mode: "UNTIL_RESUMED", pausedAt: new Date(), reopensAt: null, reopensAtLabel: null, withinHours: true };

describe("banner text per state (the owner's words)", () => {
  it("open: nothing", () => expect(orderingBanner(open)).toBeNull());

  it("closed by hours", () => {
    expect(orderingBanner(closed)).toEqual({ kind: "closed", headline: "We're closed right now.", detail: "We open tomorrow at 11:30 AM." });
  });

  it("paused until the next opening", () => {
    expect(orderingBanner(pausedTimed)).toEqual({ kind: "paused", headline: "We're not taking orders right now.", detail: "We open again today at 11:30 AM." });
  });

  it("paused until switched back on", () => {
    expect(orderingBanner(pausedManual)).toEqual({ kind: "paused", headline: "We're not taking orders right now.", detail: "Please check back soon." });
  });

  it("uses the status's finished label and never rebuilds a time", () => {
    expect(orderingBanner({ ...closed, reopensAtLabel: "today at 9:15 AM" })!.detail).toBe("We open today at 9:15 AM.");
  });
});

describe("controls", () => {
  it("open: everything allowed", () => {
    expect(orderingControls(open)).toEqual({ canOrder: true, asapAllowed: true, preorderAllowed: true, disabledReason: null });
  });

  it("closed by hours: no ASAP, pre-order still allowed", () => {
    expect(orderingControls(closed)).toEqual({ canOrder: true, asapAllowed: false, preorderAllowed: true, disabledReason: null });
  });

  it("paused: order buttons and checkout disabled with a reason, no ASAP, no pre-orders", () => {
    for (const state of [pausedTimed, pausedManual]) {
      expect(orderingControls(state)).toEqual({ canOrder: false, asapAllowed: false, preorderAllowed: false, disabledReason: "Ordering is paused right now." });
    }
  });

  it("an unreadable status does not disable ordering (the server gate decides)", () => {
    expect(orderingControls(null).canOrder).toBe(true);
  });
});
