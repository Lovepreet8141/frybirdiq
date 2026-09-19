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
import { businessDate, openHoursSpan } from "@/lib/dates";
import { isValidScheduledTime, scheduleDays } from "@/lib/cart/scheduled-time";
import { asapRefusal, businessHoursWindow, formatBusinessClock, isOpenAt, nextOpening, sessionStartDate } from "./opening-hours";

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

/**
 * Overnight hours — the case RELIABILITY found by running it, not by reading.
 *
 * An owner can put 18:00–02:00 in the Restaurant form today: `updateBusinessProfile`
 * writes both `<input type="time">` values with no check that closing is after
 * opening. Before the window wrapped, `isOpenAt` was false at every hour of the
 * day, so ASAP was refused around the clock by a message that read like nothing
 * was wrong — while `openHoursSpan` (and so Smart 86 and inventory) went on
 * treating the shop as open eight hours a day.
 */
const LATE_OPEN = "18:00";
const LATE_CLOSE = "02:00";

describe("hours that cross midnight", () => {
  it("is open in the evening and after midnight, shut in between", () => {
    // 2026-09-19 19:00 IST — inside the session that opened at 18:00.
    expect(isOpenAt(new Date("2026-09-19T13:30:00.000Z"), LATE_OPEN, LATE_CLOSE)).toBe(true);
    // 2026-09-20 00:30 IST — still that session, which runs to 02:00.
    expect(isOpenAt(new Date("2026-09-19T19:00:00.000Z"), LATE_OPEN, LATE_CLOSE)).toBe(true);
    // 2026-09-20 01:59:59.999 IST — the last moment of it.
    expect(isOpenAt(new Date("2026-09-19T20:29:59.999Z"), LATE_OPEN, LATE_CLOSE)).toBe(true);
    // 2026-09-20 02:00:00.000 IST — shut, closing is exclusive.
    expect(isOpenAt(new Date("2026-09-19T20:30:00.000Z"), LATE_OPEN, LATE_CLOSE)).toBe(false);
    // 2026-09-20 10:00 IST — the middle of the closed stretch.
    expect(isOpenAt(new Date("2026-09-20T04:30:00.000Z"), LATE_OPEN, LATE_CLOSE)).toBe(false);
    // 2026-09-20 18:00:00.000 IST — the next session opens.
    expect(isOpenAt(new Date("2026-09-20T12:30:00.000Z"), LATE_OPEN, LATE_CLOSE)).toBe(true);
  });

  it("is not shut at all 24 hours of the day, which is what the bug did", () => {
    const hours = Array.from({ length: 24 }, (_, hour) =>
      // Each whole hour of 2026-09-20 IST, i.e. from 18:30Z the day before.
      isOpenAt(new Date(Date.UTC(2026, 8, 19, 18, 30) + hour * 3_600_000), LATE_OPEN, LATE_CLOSE),
    );
    expect(hours.filter(Boolean).length).toBe(8);
  });

  it("agrees with openHoursSpan on how long the day is", () => {
    const { opening, closing } = businessHoursWindow("2026-09-19", LATE_OPEN, LATE_CLOSE);
    expect((closing.getTime() - opening.getTime()) / 3_600_000).toBe(openHoursSpan(LATE_OPEN, LATE_CLOSE));
    expect(closing.toISOString()).toBe("2026-09-19T20:30:00.000Z"); // 2026-09-20 02:00 IST
  });

  it("treats an opening equal to its closing as a full day, as openHoursSpan does", () => {
    const { opening, closing } = businessHoursWindow("2026-09-19", "09:00", "09:00");
    expect((closing.getTime() - opening.getTime()) / 3_600_000).toBe(openHoursSpan("09:00", "09:00"));
    expect(openHoursSpan("09:00", "09:00")).toBe(24);
  });

  it("accepts a scheduled time inside those hours, including one past midnight", () => {
    const now = new Date("2026-09-19T13:30:00.000Z"); // 2026-09-19 19:00 IST
    // 2026-09-19 20:00 IST — RELIABILITY's case: inside the hours, refused before.
    expect(isValidScheduledTime(new Date("2026-09-19T14:30:00.000Z"), now, LATE_OPEN, LATE_CLOSE)).toBe(true);
    // 2026-09-20 01:00 IST — belongs to the session that opened the evening before.
    expect(isValidScheduledTime(new Date("2026-09-19T19:30:00.000Z"), now, LATE_OPEN, LATE_CLOSE)).toBe(true);
    // 2026-09-20 10:00 IST — genuinely shut.
    expect(isValidScheduledTime(new Date("2026-09-20T04:30:00.000Z"), now, LATE_OPEN, LATE_CLOSE)).toBe(false);
  });

  it("stops telling the customer to come back tomorrow for ever", () => {
    // 2026-09-20 10:00 IST, shut. The next opening is 18:00 the SAME day.
    const refusal = asapRefusal(new Date("2026-09-20T04:30:00.000Z"), { openingTime: LATE_OPEN, closingTime: LATE_CLOSE });
    expect(refusal).toEqual({
      code: "CLOSED",
      openingTime: "18:00",
      closingTime: "02:00",
      opensAt: "2026-09-20T12:30:00.000Z", // 2026-09-20 18:00 IST
      opensDay: "TODAY",
      opensAtLabel: "today at 6:00 PM",
    });
  });
});

describe("asapRefusal", () => {
  const HOURS = { openingTime: OPEN, closingTime: CLOSE };

  it("returns null while the shop is open, so the order proceeds", () => {
    // 2026-09-19 18:00 IST
    expect(asapRefusal(new Date("2026-09-19T12:30:00.000Z"), HOURS)).toBeNull();
    // 2026-09-19 11:30:00.000 IST — the opening minute itself.
    expect(asapRefusal(new Date("2026-09-19T06:00:00.000Z"), HOURS)).toBeNull();
  });

  it("refuses 2am with the whole refusal, label included", () => {
    // 2026-09-19 02:00 IST. Asserting the label, not just its presence:
    // toLocaleTimeString's exact output varies by ICU build, and nothing else
    // in the suite would notice if "11:30 AM" became "11:30 am".
    expect(asapRefusal(new Date("2026-09-18T20:30:00.000Z"), HOURS)).toEqual({
      code: "CLOSED",
      openingTime: "11:30",
      closingTime: "23:00",
      opensAt: "2026-09-19T06:00:00.000Z",
      opensDay: "TODAY",
      opensAtLabel: "today at 11:30 AM",
    });
  });

  it("after closing, points at tomorrow and says so in the label", () => {
    // 2026-09-19 23:30 IST
    expect(asapRefusal(new Date("2026-09-19T18:00:00.000Z"), HOURS)).toMatchObject({
      opensAt: "2026-09-20T06:00:00.000Z",
      opensDay: "TOMORROW",
      opensAtLabel: "tomorrow at 11:30 AM",
    });
  });

  it("reads the hours it is handed, not FRYBIRD's", () => {
    // 2026-09-19 09:00 IST — open on an 08:00 opening, shut on 11:30.
    const at = new Date("2026-09-19T03:30:00.000Z");
    expect(asapRefusal(at, { openingTime: "08:00", closingTime: CLOSE })).toBeNull();
    expect(asapRefusal(at, HOURS)).toMatchObject({ openingTime: "11:30" });
  });
});

describe("formatBusinessClock", () => {
  it("renders a 12-hour wall-clock time with an upper-case meridiem", () => {
    expect(formatBusinessClock(new Date("2026-09-19T06:00:00.000Z"))).toBe("11:30 AM"); // 11:30 IST
    expect(formatBusinessClock(new Date("2026-09-19T12:30:00.000Z"))).toBe("6:00 PM"); // 18:00 IST
    expect(formatBusinessClock(new Date("2026-09-19T17:30:00.000Z"))).toBe("11:00 PM"); // 23:00 IST
  });

  it("does not leave the 12-or-24-hour choice to the ICU build", () => {
    // A build resolving en-IN to h23 would render "18:00" here, with no
    // meridiem to normalise — so this assertion is what notices if `hour12`
    // ever stops being passed explicitly.
    expect(formatBusinessClock(new Date("2026-09-19T12:30:00.000Z"))).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/u);
  });

  it("uses a plain space, whatever separator the build emits", () => {
    // This build puts U+202F before the meridiem; the label must not carry it.
    expect(formatBusinessClock(new Date("2026-09-19T06:00:00.000Z"))).not.toMatch(/[  ]/u);
  });

  it("is the same formatter the schedule picker labels slots with", () => {
    // One wall-clock convention across the customer surfaces: the picker's
    // first slot and the refusal's label cannot disagree about "11:30 AM".
    const [today] = scheduleDays(new Date("2026-09-19T04:00:00.000Z"), OPEN, CLOSE); // 09:30 IST
    expect(today?.slots[0]?.label).toBe(formatBusinessClock(today!.slots[0]!.at));
    expect(today?.slots[0]?.label).toBe("11:30 AM");
  });
});

/**
 * The horizon, bounded by the session a time belongs to rather than the
 * calendar date it reads (p0-3d). RELIABILITY measured the defect: with
 * 18:00–02:00 hours the picker's last day offered 32 slots and the validator
 * refused 8 of them, the shop being open at every one.
 */
describe("the scheduling horizon under hours that cross midnight", () => {
  const NOW = new Date("2026-09-19T06:30:00.000Z"); // 2026-09-19 12:00 IST

  it("names the session a time belongs to, which is not always its own date", () => {
    // 2026-09-19 19:00 IST — inside the session that opened that evening.
    expect(sessionStartDate(new Date("2026-09-19T13:30:00.000Z"), LATE_OPEN, LATE_CLOSE)).toBe("2026-09-19");
    // 2026-09-20 00:30 IST — the calendar has turned, the session has not.
    expect(sessionStartDate(new Date("2026-09-19T19:00:00.000Z"), LATE_OPEN, LATE_CLOSE)).toBe("2026-09-19");
    // 2026-09-20 10:00 IST — shut, so no session.
    expect(sessionStartDate(new Date("2026-09-20T04:30:00.000Z"), LATE_OPEN, LATE_CLOSE)).toBeNull();
    // Hours that do not cross midnight: the session date IS the candidate's date.
    expect(sessionStartDate(new Date("2026-09-19T12:30:00.000Z"), OPEN, CLOSE)).toBe("2026-09-19");
  });

  it("accepts every slot the picker offers, which it did not before", () => {
    const days = scheduleDays(NOW, LATE_OPEN, LATE_CLOSE);
    const offered = days.flatMap((day) => day.slots);
    expect(offered.length).toBe(64); // 32 on each of the two days
    expect(offered.filter((slot) => !isValidScheduledTime(slot.at, NOW, LATE_OPEN, LATE_CLOSE))).toEqual([]);
  });

  it("accepted the exact instant RELIABILITY measured as refused", () => {
    // 2026-09-21 00:00 IST, labelled "12:00 AM" by the picker — the first of
    // the eight. It belongs to the session that opened on the 20th, which is
    // the horizon itself.
    const firstRefused = new Date("2026-09-20T18:30:00.000Z");
    expect(sessionStartDate(firstRefused, LATE_OPEN, LATE_CLOSE)).toBe("2026-09-20");
    expect(isOpenAt(firstRefused, LATE_OPEN, LATE_CLOSE)).toBe(true);
    expect(isValidScheduledTime(firstRefused, NOW, LATE_OPEN, LATE_CLOSE)).toBe(true);
  });

  it("still refuses the session after the horizon", () => {
    // 2026-09-21 19:00 IST — the session starting on the 21st, one day beyond
    // a horizon of today + 1. Open, but further ahead than scheduling goes.
    const beyond = new Date("2026-09-21T13:30:00.000Z");
    expect(isOpenAt(beyond, LATE_OPEN, LATE_CLOSE)).toBe(true);
    expect(isValidScheduledTime(beyond, NOW, LATE_OPEN, LATE_CLOSE)).toBe(false);
  });

  it("accepts a time tonight whose session began yesterday", () => {
    // This is why the bound is upper-only. Now is 2026-09-20 00:00 IST, the
    // shop open on the session that started on the 19th; a time 30 minutes
    // away belongs to that session, whose date is *before* today's. A lower
    // bound on the session date would refuse a perfectly orderable time.
    const justAfterMidnight = new Date("2026-09-19T18:30:00.000Z"); // 2026-09-20 00:00 IST
    const halfAnHourLater = new Date("2026-09-19T19:00:00.000Z"); // 2026-09-20 00:30 IST
    expect(sessionStartDate(halfAnHourLater, LATE_OPEN, LATE_CLOSE)).toBe("2026-09-19");
    expect(businessDate(justAfterMidnight)).toBe("2026-09-20");
    expect(isValidScheduledTime(halfAnHourLater, justAfterMidnight, LATE_OPEN, LATE_CLOSE)).toBe(true);
  });

  it("leaves 11:30-23:00 exactly as it was", () => {
    // Every slot offered is accepted, and the day after the horizon is not.
    const offered = scheduleDays(NOW, OPEN, CLOSE).flatMap((day) => day.slots);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((slot) => !isValidScheduledTime(slot.at, NOW, OPEN, CLOSE))).toEqual([]);
    // 2026-09-21 12:00 IST — open, beyond the horizon, refused as before.
    expect(isValidScheduledTime(new Date("2026-09-21T06:30:00.000Z"), NOW, OPEN, CLOSE)).toBe(false);
  });

  it("still refuses a time inside the lead window, and an invalid date", () => {
    // 2026-09-19 19:10 IST against a now of 19:00 — open, but ten minutes off.
    const now = new Date("2026-09-19T13:30:00.000Z");
    expect(isValidScheduledTime(new Date("2026-09-19T13:40:00.000Z"), now, LATE_OPEN, LATE_CLOSE)).toBe(false);
    expect(isValidScheduledTime(new Date("not a date"), now, LATE_OPEN, LATE_CLOSE)).toBe(false);
  });
});
