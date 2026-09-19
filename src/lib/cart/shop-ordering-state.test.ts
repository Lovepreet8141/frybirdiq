/**
 * shopOrderingState — the one open/closed/paused answer for customer pages,
 * derived from the server gate so the page and a submit cannot disagree
 * (ops-1, RELIABILITY req R1). IST instants as UTC literals.
 */

import { describe, expect, it } from "vitest";
import { orderingRefusal } from "@/lib/orders/opening-hours";
import { shopOrderingState } from "./shop-hours";

const HOURS = { openingTime: "11:30", closingTime: "23:00" };
const MIDDAY = new Date("2026-09-19T12:30:00.000Z"); // 18:00 IST
const TWO_AM = new Date("2026-09-18T20:30:00.000Z"); // 02:00 IST
const PAUSED_AT = new Date("2026-09-19T12:00:00.000Z");

describe("shopOrderingState", () => {
  it("is OPEN in the hours with nothing paused", () => {
    expect(shopOrderingState(MIDDAY, { ...HOURS, orderingPausedAt: null })).toEqual({ state: "OPEN", closesAt: "23:00" });
  });

  it("is CLOSED outside the hours with nothing paused", () => {
    expect(shopOrderingState(TWO_AM, { ...HOURS, orderingPausedAt: null })).toEqual({ state: "CLOSED", opensAt: "11:30", opensToday: true });
  });

  it("is PAUSED inside the hours — what the home page and checkout could not see before", () => {
    expect(shopOrderingState(MIDDAY, { ...HOURS, orderingPausedAt: PAUSED_AT })).toEqual({ state: "PAUSED", withinHours: true });
  });

  it("is PAUSED outside the hours too, and says so, so copy can drop 'check back soon'", () => {
    expect(shopOrderingState(TWO_AM, { ...HOURS, orderingPausedAt: PAUSED_AT })).toEqual({ state: "PAUSED", withinHours: false });
  });

  it("agrees with the server gate on every combination — page and submit cannot disagree", () => {
    for (const now of [MIDDAY, TWO_AM]) {
      for (const orderingPausedAt of [null, PAUSED_AT]) {
        const shop = { ...HOURS, orderingPausedAt };
        const page = shopOrderingState(now, shop).state;
        const gate = orderingRefusal(now, shop, "ASAP");
        expect(page).toBe(gate === null ? "OPEN" : gate.kind);
      }
    }
  });
});
