/**
 * shopOrderingState — the one open / closedByHours / paused answer for every
 * screen, derived from the server gate so a page and a submit cannot disagree
 * (ops-1, RELIABILITY req R1; owner requirements 1-2). IST instants as UTC
 * literals.
 */

import { describe, expect, it } from "vitest";
import { orderingRefusal, type ShopStatus } from "@/lib/orders/opening-hours";
import { shopOrderingState } from "./shop-hours";

const HOURS = { openingTime: "11:30", closingTime: "23:00" };
const MIDDAY = new Date("2026-09-19T12:30:00.000Z"); // 18:00 IST
const TWO_AM = new Date("2026-09-18T20:30:00.000Z"); // 02:00 IST
const PAUSED_AT = new Date("2026-09-19T12:00:00.000Z"); // 17:30 IST
const NEXT_OPENING = new Date("2026-09-20T06:00:00.000Z"); // 2026-09-20 11:30 IST

const shop = (orderingPausedAt: Date | null, orderingPausedUntil: Date | null): ShopStatus => ({ ...HOURS, orderingPausedAt, orderingPausedUntil });

describe("shopOrderingState", () => {
  it("open in the hours with nothing paused", () => {
    expect(shopOrderingState(MIDDAY, shop(null, null))).toEqual({ state: "open", closesAt: "23:00" });
  });

  it("closedByHours outside them, with the same label the hours refusal prints", () => {
    expect(shopOrderingState(TWO_AM, shop(null, null))).toEqual({
      state: "closedByHours",
      reopensAt: new Date("2026-09-19T06:00:00.000Z"),
      reopensAtLabel: "today at 11:30 AM",
    });
  });

  it("paused until next opening: says when it reopens — 'We open again tomorrow at 11:30 AM'", () => {
    expect(shopOrderingState(MIDDAY, shop(PAUSED_AT, NEXT_OPENING))).toEqual({
      state: "paused",
      mode: "UNTIL_NEXT_OPENING",
      pausedAt: PAUSED_AT,
      reopensAt: NEXT_OPENING,
      reopensAtLabel: "tomorrow at 11:30 AM",
      withinHours: true,
    });
  });

  it("paused until switched back on: no reopening time — 'Please check back soon'", () => {
    expect(shopOrderingState(MIDDAY, shop(PAUSED_AT, null))).toEqual({
      state: "paused",
      mode: "UNTIL_RESUMED",
      pausedAt: PAUSED_AT,
      reopensAt: null,
      reopensAtLabel: null,
      withinHours: true,
    });
  });

  it("after midnight, a pause ending at 11:30 the same date reads 'today', not 'tomorrow'", () => {
    // Checked 2026-09-20 00:30 IST; the pause ends 2026-09-20 11:30 IST.
    const afterMidnight = new Date("2026-09-19T19:00:00.000Z");
    expect(shopOrderingState(afterMidnight, shop(PAUSED_AT, NEXT_OPENING))).toMatchObject({ reopensAtLabel: "today at 11:30 AM", withinHours: false });
  });

  it("a timed pause that has ended reads open again, although paused_at is still in the row", () => {
    expect(shopOrderingState(new Date("2026-09-20T07:00:00.000Z"), shop(PAUSED_AT, NEXT_OPENING))).toEqual({ state: "open", closesAt: "23:00" });
  });

  it("agrees with the server gate on every combination — no screen can disagree with a submit", () => {
    const expected = { null: "open", PAUSED: "paused", CLOSED: "closedByHours" } as const;
    for (const now of [MIDDAY, TWO_AM, NEXT_OPENING, new Date("2026-09-20T07:00:00.000Z")]) {
      for (const [at, until] of [[null, null], [PAUSED_AT, null], [PAUSED_AT, NEXT_OPENING]] as const) {
        const s = shop(at, until);
        const gate = orderingRefusal(now, s, "ASAP");
        expect(shopOrderingState(now, s).state).toBe(expected[gate === null ? "null" : gate.kind]);
      }
    }
  });
});
