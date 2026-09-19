/**
 * The online-ordering gate with the Close Shop switch (ops-1).
 *
 * Instants are UTC literals with the IST time they stand for in a comment,
 * same convention as opening-hours.test.ts: 11:30 IST = 06:00Z.
 */

import { describe, expect, it } from "vitest";
import { orderingRefusal, type ShopStatus } from "./opening-hours";

const HOURS = { openingTime: "11:30", closingTime: "23:00" };
const OPEN_SHOP: ShopStatus = { ...HOURS, orderingPausedAt: null };
const PAUSED_SHOP: ShopStatus = { ...HOURS, orderingPausedAt: new Date("2026-09-19T12:00:00.000Z") }; // paused 17:30 IST

const MIDDAY = new Date("2026-09-19T12:30:00.000Z"); // 18:00 IST — well inside the hours
const TWO_AM = new Date("2026-09-18T20:30:00.000Z"); // 02:00 IST — outside them

describe("orderingRefusal — the switch", () => {
  it("refuses an ASAP order while paused, even in the middle of trading hours", () => {
    // The whole point of the switch: the hours say open, the kitchen is on
    // fire. Before ops-1 there was no input by which this could be refused
    // without editing the trading hours themselves.
    expect(orderingRefusal(MIDDAY, PAUSED_SHOP, "ASAP")).toEqual({ kind: "PAUSED", paused: { code: "PAUSED" } });
  });

  it("refuses a scheduled order while paused, too", () => {
    // No end time on the switch, so no future slot can be promised.
    expect(orderingRefusal(MIDDAY, PAUSED_SHOP, "SCHEDULED")).toEqual({ kind: "PAUSED", paused: { code: "PAUSED" } });
  });

  it("says paused, not 'we open at 11:30', when paused outside the hours as well", () => {
    // "We open at 11:30" would be a promise nobody can keep while the switch
    // is still on. Paused is the stronger fact.
    expect(orderingRefusal(TWO_AM, PAUSED_SHOP, "ASAP")).toEqual({ kind: "PAUSED", paused: { code: "PAUSED" } });
  });

  it("never carries the hours refusal while paused — the form would send the customer to Choose a time", () => {
    // checkout-form.tsx moves a customer onto SCHEDULED whenever `closed` is
    // set. While paused that choice is refused too, so the paused result must
    // not have a `closed` field for the form to find.
    for (const when of ["ASAP", "SCHEDULED"] as const) {
      for (const now of [MIDDAY, TWO_AM]) {
        const refusal = orderingRefusal(now, PAUSED_SHOP, when);
        expect(refusal?.kind).toBe("PAUSED");
        expect(refusal && "closed" in refusal).toBe(false);
      }
    }
  });

  it("carries nothing staff typed — the refusal is a bare code", () => {
    const refusal = orderingRefusal(MIDDAY, PAUSED_SHOP, "ASAP");
    if (refusal?.kind !== "PAUSED") throw new Error("expected a PAUSED refusal");
    expect(Object.keys(refusal.paused)).toEqual(["code"]);
  });
});

describe("orderingRefusal — not paused, behaves exactly as the P0-3a gate did", () => {
  it("lets an ASAP order through inside the hours", () => {
    expect(orderingRefusal(MIDDAY, OPEN_SHOP, "ASAP")).toBeNull();
  });

  it("refuses an ASAP order outside the hours with the unchanged hours refusal", () => {
    expect(orderingRefusal(TWO_AM, OPEN_SHOP, "ASAP")).toEqual({
      kind: "CLOSED",
      closed: {
        code: "CLOSED",
        openingTime: "11:30",
        closingTime: "23:00",
        opensAt: "2026-09-19T06:00:00.000Z",
        opensDay: "TODAY",
        opensAtLabel: "today at 11:30 AM",
      },
    });
  });

  it("lets a scheduled order through at any hour — its requested time is isValidScheduledTime's question", () => {
    expect(orderingRefusal(TWO_AM, OPEN_SHOP, "SCHEDULED")).toBeNull();
    expect(orderingRefusal(MIDDAY, OPEN_SHOP, "SCHEDULED")).toBeNull();
  });
});
