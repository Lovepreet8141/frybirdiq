import { describe, expect, it } from "vitest";
import { orderingBanner, orderingControls } from "./ordering-banner";
import { type ShopOrderingState, shopOrderingState } from "./shop-hours";

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

describe("closed by the hours AND switched off: the switch's banner wins", () => {
  const NIGHT = new Date("2026-09-19T22:00:00.000Z"); // 03:30 IST, well outside 11:30-23:00
  const base = { openingTime: "11:30", closingTime: "23:00" };

  it("switched off until we next open, in the small hours: the paused banner, with the opening time", () => {
    const state = shopOrderingState(NIGHT, { ...base, orderingPausedAt: new Date("2026-09-19T17:00:00Z"), orderingPausedUntil: new Date("2026-09-20T06:00:00Z") });
    expect(state.state).toBe("paused");
    expect(orderingBanner(state)).toEqual({ kind: "paused", headline: "We're not taking orders right now.", detail: "We open again today at 11:30 AM." });
  });

  it("switched off until switched back on, in the small hours: the paused banner, never 'we open at 11:30'", () => {
    const state = shopOrderingState(NIGHT, { ...base, orderingPausedAt: new Date("2026-09-19T17:00:00Z"), orderingPausedUntil: null });
    expect(orderingBanner(state)).toEqual({ kind: "paused", headline: "We're not taking orders right now.", detail: "Please check back soon." });
    // and the controls are the paused ones: no pre-orders either.
    expect(orderingControls(state).preorderAllowed).toBe(false);
  });

  it("once switched back on, the same hour shows the hours banner", () => {
    const state = shopOrderingState(NIGHT, { ...base, orderingPausedAt: null, orderingPausedUntil: null });
    expect(orderingBanner(state)?.kind).toBe("closed");
  });
});
