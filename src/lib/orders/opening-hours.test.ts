/**
 * The opening-hours gate, asserted in Asia/Kolkata wall-clock time.
 *
 * Every instant below is written as an explicit UTC literal with the IST time
 * it stands for in a comment, because a UTC off-by-one here is worse than the
 * bug this closes: IST is UTC+5:30, so 11:30 IST is 06:00Z and 23:00 IST is
 * 17:30Z. Nothing in this file reads the machine's timezone — `@/lib/dates`
 * does fixed-offset arithmetic — so these assertions hold on a CI box in UTC
 * and on a laptop in Ambala alike.
 */

import { describe, expect, it } from "vitest";
import { isValidScheduledTime } from "@/lib/cart/scheduled-time";
import { businessHoursWindow, isOpenAt, nextOpening } from "./opening-hours";

/** FRYBIRD's real configured hours (organizations.opening_time / closing_time defaults). */
const OPEN = "11:30";
const CLOSE = "23:00";

describe("isOpenAt", () => {
  it("is open through the middle of the day", () => {
    // 2026-09-19 18:00 IST
    expect(isOpenAt(new Date("2026-09-19T12:30:00.000Z"), OPEN, CLOSE)).toBe(true);
  });

  it("is shut at 2am — the order the audit found being accepted", () => {
    // 2026-09-19 02:00 IST
    expect(isOpenAt(new Date("2026-09-18T20:30:00.000Z"), OPEN, CLOSE)).toBe(false);
  });

  it("opens exactly on the opening minute, and not one millisecond before", () => {
    // 2026-09-19 11:30:00.000 IST
    expect(isOpenAt(new Date("2026-09-19T06:00:00.000Z"), OPEN, CLOSE)).toBe(true);
    // 2026-09-19 11:29:59.999 IST
    expect(isOpenAt(new Date("2026-09-19T05:59:59.999Z"), OPEN, CLOSE)).toBe(false);
  });

  it("shuts exactly on the closing minute, having been open the second before", () => {
    // 2026-09-19 22:59:59.999 IST
    expect(isOpenAt(new Date("2026-09-19T17:29:59.999Z"), OPEN, CLOSE)).toBe(true);
    // 2026-09-19 23:00:00.000 IST
    expect(isOpenAt(new Date("2026-09-19T17:30:00.000Z"), OPEN, CLOSE)).toBe(false);
  });

  it("reads the org's hours rather than assuming FRYBIRD's", () => {
    // 2026-09-19 09:00 IST — shut on 11:30, open on an 08:00 opening.
    const at = new Date("2026-09-19T03:30:00.000Z");
    expect(isOpenAt(at, OPEN, CLOSE)).toBe(false);
    expect(isOpenAt(at, "08:00", CLOSE)).toBe(true);
  });

  it("puts a post-midnight instant on the right business day, not the previous one", () => {
    // 2026-09-20 00:30 IST — the UTC date is still the 19th. Shut either way,
    // but a day computed in UTC would compare it against the 19th's window.
    const justAfterMidnight = new Date("2026-09-19T19:00:00.000Z");
    expect(isOpenAt(justAfterMidnight, OPEN, CLOSE)).toBe(false);
    // 2026-09-20 11:30 IST, i.e. the 20th's opening, not the 19th's.
    expect(nextOpening(justAfterMidnight, OPEN, CLOSE)).toEqual({
      at: new Date("2026-09-20T06:00:00.000Z"),
      day: "TODAY",
    });
  });
});

describe("nextOpening", () => {
  it("before opening, points at later the same day", () => {
    // 2026-09-19 02:00 IST → 2026-09-19 11:30 IST
    expect(nextOpening(new Date("2026-09-18T20:30:00.000Z"), OPEN, CLOSE)).toEqual({
      at: new Date("2026-09-19T06:00:00.000Z"),
      day: "TODAY",
    });
  });

  it("after closing, points at tomorrow", () => {
    // 2026-09-19 23:30 IST → 2026-09-20 11:30 IST
    expect(nextOpening(new Date("2026-09-19T18:00:00.000Z"), OPEN, CLOSE)).toEqual({
      at: new Date("2026-09-20T06:00:00.000Z"),
      day: "TOMORROW",
    });
  });

  it("on the closing minute itself, points at tomorrow — closing is exclusive", () => {
    // 2026-09-19 23:00:00.000 IST → 2026-09-20 11:30 IST
    expect(nextOpening(new Date("2026-09-19T17:30:00.000Z"), OPEN, CLOSE)).toEqual({
      at: new Date("2026-09-20T06:00:00.000Z"),
      day: "TOMORROW",
    });
  });

  it("crosses the month end without help", () => {
    // 2026-09-30 23:30 IST → 2026-10-01 11:30 IST
    expect(nextOpening(new Date("2026-09-30T18:00:00.000Z"), OPEN, CLOSE)).toEqual({
      at: new Date("2026-10-01T06:00:00.000Z"),
      day: "TOMORROW",
    });
  });
});

describe("one definition of opening hours", () => {
  it("gives ASAP and 'choose a time' the same window, boundary included", () => {
    // Both paths must agree on 11:30:00 and on 23:00:00, or ASAP and the
    // scheduler refuse each other's edge. Checked at midday the day before so
    // the scheduled candidate clears its own 20-minute lead time and stays
    // inside the two-day horizon.
    const now = new Date("2026-09-19T06:30:00.000Z"); // 2026-09-19 12:00 IST
    const opening = new Date("2026-09-20T06:00:00.000Z"); // 2026-09-20 11:30 IST
    const closing = new Date("2026-09-20T17:30:00.000Z"); // 2026-09-20 23:00 IST

    expect(isValidScheduledTime(opening, now, OPEN, CLOSE)).toBe(true);
    expect(isOpenAt(opening, OPEN, CLOSE)).toBe(true);

    expect(isValidScheduledTime(closing, now, OPEN, CLOSE)).toBe(false);
    expect(isOpenAt(closing, OPEN, CLOSE)).toBe(false);
  });

  it("window is inclusive of opening and exclusive of closing", () => {
    const { opening, closing } = businessHoursWindow("2026-09-19", OPEN, CLOSE);
    expect(opening.toISOString()).toBe("2026-09-19T06:00:00.000Z");
    expect(closing.toISOString()).toBe("2026-09-19T17:30:00.000Z");
  });
});
