/**
 * The online-ordering gate with the Close Shop switch (ops-1).
 *
 * Instants are UTC literals with the IST time they stand for in a comment,
 * same convention as opening-hours.test.ts: 11:30 IST = 06:00Z.
 */

import { describe, expect, it } from "vitest";
import { orderingRefusal, pauseCarriedOver, pausedUntilFor, type ShopStatus } from "./opening-hours";

const HOURS = { openingTime: "11:30", closingTime: "23:00" };
const OPEN_SHOP: ShopStatus = { ...HOURS, orderingPausedAt: null, orderingPausedUntil: null };
// Manual pause ("until I switch it back on"): no end.
const PAUSED_SHOP: ShopStatus = { ...HOURS, orderingPausedAt: new Date("2026-09-19T12:00:00.000Z"), orderingPausedUntil: null }; // paused 17:30 IST

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

describe("a missing pause value is not a pause (RELIABILITY ops-1 req 4)", () => {
  it("takes orders when orderingPausedAt arrives undefined, instead of refusing everyone", () => {
    // What a hand-mapped org object that forgets the new column looks like at
    // run time. Reading it as paused would be a silent total outage.
    const forgotten = { ...HOURS } as unknown as ShopStatus;
    expect(orderingRefusal(MIDDAY, forgotten, "ASAP")).toBeNull();
    expect(orderingRefusal(MIDDAY, forgotten, "SCHEDULED")).toBeNull();
  });

  it("still pauses on a real timestamp", () => {
    expect(orderingRefusal(MIDDAY, PAUSED_SHOP, "ASAP")?.kind).toBe("PAUSED");
  });
});

describe("pauseCarriedOver — the forgot-to-reopen case (ops-1 R1)", () => {
  const PAUSED_YESTERDAY_EVENING = new Date("2026-09-18T14:12:00.000Z"); // 2026-09-18 19:42 IST
  const manual = (orderingPausedAt: Date | null): ShopStatus => ({ ...HOURS, orderingPausedAt, orderingPausedUntil: null });

  it("is true on the next day's set-up, before opening — the moment to decide", () => {
    // 2026-09-19 10:00 IST, before the 11:30 opening.
    expect(pauseCarriedOver(manual(PAUSED_YESTERDAY_EVENING), new Date("2026-09-19T04:30:00.000Z"))).toBe(true);
  });

  it("is true after opening too, if nobody decided at set-up", () => {
    expect(pauseCarriedOver(manual(PAUSED_YESTERDAY_EVENING), new Date("2026-09-19T06:30:00.000Z"))).toBe(true); // 12:00 IST
  });

  it("is false for a pause set during today's trade", () => {
    const pausedAtOne = new Date("2026-09-19T07:30:00.000Z"); // 13:00 IST
    expect(pauseCarriedOver(manual(pausedAtOne), new Date("2026-09-19T09:30:00.000Z"))).toBe(false); // 15:00 IST
  });

  it("is false when nothing is paused, or the value is missing", () => {
    const now = new Date("2026-09-19T06:30:00.000Z");
    expect(pauseCarriedOver(manual(null), now)).toBe(false);
    expect(pauseCarriedOver({ ...HOURS } as unknown as ShopStatus, now)).toBe(false);
  });

  it("is false once a timed pause has reopened by itself — nothing is left to decide", () => {
    // Paused yesterday 19:42 until today's 11:30 opening; checked at 12:00.
    const timed: ShopStatus = { ...HOURS, orderingPausedAt: PAUSED_YESTERDAY_EVENING, orderingPausedUntil: new Date("2026-09-19T06:00:00.000Z") };
    expect(pauseCarriedOver(timed, new Date("2026-09-19T06:30:00.000Z"))).toBe(false);
  });
});

/**
 * The owner's two modes (ops-1 owner requirements 1 and 3). A timed pause
 * reopens by TIME — there is no job — so these are the tests that prove the
 * shop actually comes back.
 */
describe("pause modes — until we next open, and until switched back on", () => {
  const PAUSED_AT = new Date("2026-09-19T13:30:00.000Z"); // 2026-09-19 19:00 IST, a fire mid-service
  const NEXT_OPENING = new Date("2026-09-20T06:00:00.000Z"); // 2026-09-20 11:30 IST

  it("UNTIL_NEXT_OPENING ends at the next opening from the hours", () => {
    expect(pausedUntilFor("UNTIL_NEXT_OPENING", PAUSED_AT, "11:30", "23:00")).toEqual(NEXT_OPENING);
  });

  it("UNTIL_RESUMED has no end", () => {
    expect(pausedUntilFor("UNTIL_RESUMED", PAUSED_AT, "11:30", "23:00")).toBeNull();
  });

  it("a timed pause refuses one millisecond before it ends, and takes orders at that instant and after", () => {
    const timed: ShopStatus = { ...HOURS, orderingPausedAt: PAUSED_AT, orderingPausedUntil: NEXT_OPENING };
    const justBefore = new Date(NEXT_OPENING.getTime() - 1); // 11:29:59.999 IST
    expect(orderingRefusal(justBefore, timed, "ASAP")?.kind).toBe("PAUSED");
    expect(orderingRefusal(justBefore, timed, "SCHEDULED")?.kind).toBe("PAUSED");
    expect(orderingRefusal(NEXT_OPENING, timed, "ASAP")).toBeNull(); // 11:30:00.000 — open, and within hours
    expect(orderingRefusal(new Date("2026-09-20T07:00:00.000Z"), timed, "ASAP")).toBeNull(); // 12:30 IST
  });

  it("a manual pause stays closed past the next opening, all day, until someone switches it back on", () => {
    const manualPause: ShopStatus = { ...HOURS, orderingPausedAt: PAUSED_AT, orderingPausedUntil: null };
    for (const iso of ["2026-09-20T06:00:00.000Z", "2026-09-20T12:30:00.000Z", "2026-09-22T12:30:00.000Z"]) {
      expect(orderingRefusal(new Date(iso), manualPause, "ASAP")?.kind).toBe("PAUSED");
      expect(orderingRefusal(new Date(iso), manualPause, "SCHEDULED")?.kind).toBe("PAUSED");
    }
  });

  it("paused BEFORE opening, the default ends at today's opening — the edge the confirm must spell out", () => {
    // 2026-09-19 09:00 IST, the fryer broken. "Until we next open" = 11:30 today:
    // the default pause adds nothing the hours were not already doing.
    const nineAm = new Date("2026-09-19T03:30:00.000Z");
    expect(pausedUntilFor("UNTIL_NEXT_OPENING", nineAm, "11:30", "23:00")).toEqual(new Date("2026-09-19T06:00:00.000Z"));
  });

  it("a timed pause with its end missing still holds — someone did press Pause", () => {
    const lost = { ...HOURS, orderingPausedAt: PAUSED_AT } as unknown as ShopStatus;
    expect(orderingRefusal(new Date("2026-09-22T12:30:00.000Z"), lost, "ASAP")?.kind).toBe("PAUSED");
  });
});
