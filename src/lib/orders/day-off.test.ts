/**
 * Day off and planned closures (ops-3), through every pure layer that decides
 * "may this be ordered": the hours module, the write gate, the picker, the one
 * ordering state, the banner and the staff pill. Instants are IST wall-clock
 * literals. 2026-09-22 is a TUESDAY (the owner's weekly off day).
 */

import { describe, expect, it } from "vitest";
import { orderingBanner, orderingControls } from "@/lib/cart/ordering-banner";
import { isValidScheduledTime, scheduleDays } from "@/lib/cart/scheduled-time";
import { shopOrderingState } from "@/lib/cart/shop-hours";
import type { StaffOrderingStatus } from "@/lib/repositories/shop-status";
import { type Closures, NO_CLOSURES, closedDay, isClosedDay, normaliseWeekdays, weekdayOf } from "./closures";
import { asapRefusal, dayPhrase, isOpenAt, nextOpening, openingOnOrAfter, opensAtPhrase, orderingRefusal, pausedUntilFor, sessionStartDate, type ShopStatus } from "./opening-hours";
import { clockOrTomorrow, pillDetail, pillView, statusSignature } from "./shop-pill";
import { writeGate } from "./write-gate";

const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const OPEN = "11:30";
const CLOSE = "23:00";

const TUESDAYS: Closures = { weeklyClosedDays: [2], closedDates: [] };
const DIWALI: Closures = { weeklyClosedDays: [], closedDates: [{ startDate: "2026-09-24", endDate: "2026-09-25", note: "Closed for Diwali" }] };
const BOTH: Closures = { weeklyClosedDays: [2], closedDates: [{ startDate: "2026-09-23", endDate: "2026-09-24", note: "Wedding in the family" }] };

const shop = (closures: Closures, over: Partial<ShopStatus> = {}): ShopStatus => ({ openingTime: OPEN, closingTime: CLOSE, closures, orderingPausedAt: null, orderingPausedUntil: null, ...over });

describe("weekday and closed-day lookups", () => {
  it("2026-09-22 is a Tuesday, whatever the machine's timezone", () => {
    expect(weekdayOf("2026-09-22")).toBe(2);
    expect(weekdayOf("2026-09-20")).toBe(0);
    expect(weekdayOf("2026-01-01")).toBe(4);
  });

  it("a planned date wins over the weekly day, so its note shows", () => {
    expect(closedDay("2026-09-22", BOTH)).toMatchObject({ source: "WEEKLY", weekday: 2 });
    expect(closedDay("2026-09-23", BOTH)).toEqual({ source: "DATE", note: "Wedding in the family" });
    expect(closedDay("2026-09-25", BOTH)).toBeNull();
  });

  it("a range is inclusive at both ends", () => {
    expect(isClosedDay("2026-09-23", DIWALI)).toBe(false);
    expect(isClosedDay("2026-09-24", DIWALI)).toBe(true);
    expect(isClosedDay("2026-09-25", DIWALI)).toBe(true);
    expect(isClosedDay("2026-09-26", DIWALI)).toBe(false);
  });

  it("missing closures mean open every day; junk weekdays are dropped, not obeyed", () => {
    expect(isClosedDay("2026-09-22", undefined)).toBe(false);
    expect(isClosedDay("2026-09-22", NO_CLOSURES)).toBe(false);
    expect(normaliseWeekdays(undefined)).toEqual([]);
    expect(normaliseWeekdays(null)).toEqual([]);
    expect(normaliseWeekdays([2, 2, 9, -1, 1.5, "3", 0])).toEqual([0, 2]);
  });
});

describe("isOpenAt / sessionStartDate", () => {
  it("Tuesday, in the middle of trading hours: closed. Wednesday same time: open", () => {
    expect(isOpenAt(ist("2026-09-22", "14:00"), OPEN, CLOSE, TUESDAYS)).toBe(false);
    expect(isOpenAt(ist("2026-09-23", "14:00"), OPEN, CLOSE, TUESDAYS)).toBe(true);
  });

  it("without closures nothing changes: Tuesday is open", () => {
    expect(isOpenAt(ist("2026-09-22", "14:00"), OPEN, CLOSE)).toBe(true);
  });

  it("a planned range closes every day in it", () => {
    expect(isOpenAt(ist("2026-09-24", "14:00"), OPEN, CLOSE, DIWALI)).toBe(false);
    expect(isOpenAt(ist("2026-09-25", "14:00"), OPEN, CLOSE, DIWALI)).toBe(false);
    expect(isOpenAt(ist("2026-09-26", "14:00"), OPEN, CLOSE, DIWALI)).toBe(true);
  });

  it("the session on a closed day has no start date", () => {
    expect(sessionStartDate(ist("2026-09-22", "14:00"), OPEN, CLOSE, TUESDAYS)).toBeNull();
    expect(sessionStartDate(ist("2026-09-23", "14:00"), OPEN, CLOSE, TUESDAYS)).toBe("2026-09-23");
  });

  it("overnight hours: the session that STARTS on the closed day is the closed one, not the calendar date the clock reads", () => {
    // 18:00-02:00. Tuesday's session runs to 02:00 Wednesday: 00:30 Wednesday belongs to it (closed);
    // Wednesday's own session starts 18:00 Wednesday.
    expect(isOpenAt(ist("2026-09-23", "00:30"), "18:00", "02:00", TUESDAYS)).toBe(false);
    expect(isOpenAt(ist("2026-09-22", "00:30"), "18:00", "02:00", TUESDAYS)).toBe(true); // Monday's session, still trading
    expect(isOpenAt(ist("2026-09-23", "19:00"), "18:00", "02:00", TUESDAYS)).toBe(true);
  });
});

describe("nextOpening — skips days off", () => {
  it("Monday night with Tuesday off: Wednesday, and it says LATER", () => {
    const next = nextOpening(ist("2026-09-21", "23:30"), OPEN, CLOSE, TUESDAYS);
    expect(next).toMatchObject({ date: "2026-09-23", day: "LATER" });
    expect(next.at).toEqual(ist("2026-09-23", "11:30"));
  });

  it("Tuesday morning, before 11:30: still Wednesday — today is closed all day, so today's opening does not count", () => {
    const next = nextOpening(ist("2026-09-22", "09:00"), OPEN, CLOSE, TUESDAYS);
    expect(next).toMatchObject({ date: "2026-09-23", day: "TOMORROW" });
  });

  it("without closures Tuesday morning is today's opening, as before", () => {
    expect(nextOpening(ist("2026-09-22", "09:00"), OPEN, CLOSE)).toMatchObject({ date: "2026-09-22", day: "TODAY" });
  });

  it("skips a run of planned closed dates and the weekly day together", () => {
    // Wed 23 and Thu 24 planned, Tue 22 weekly: from Mon night, first open day is Fri 25.
    const next = nextOpening(ist("2026-09-21", "23:30"), OPEN, CLOSE, BOTH);
    expect(next.date).toBe("2026-09-25");
  });

  it("openingOnOrAfter counts the given day when it is open", () => {
    expect(openingOnOrAfter("2026-09-23", OPEN, CLOSE, TUESDAYS).date).toBe("2026-09-23");
    expect(openingOnOrAfter("2026-09-22", OPEN, CLOSE, TUESDAYS).date).toBe("2026-09-23");
  });

  it("refuses to invent a time when the closures leave no open day (the constraint forbids it; this is the backstop)", () => {
    const never: Closures = { weeklyClosedDays: [0, 1, 2, 3, 4, 5, 6], closedDates: [] };
    expect(() => openingOnOrAfter("2026-09-22", OPEN, CLOSE, never)).toThrow(/never opening/);
  });
});

describe("how a day is said to a customer", () => {
  it("today, tomorrow, the weekday within the week, the date beyond it", () => {
    expect(dayPhrase("2026-09-21", "2026-09-21")).toBe("today");
    expect(dayPhrase("2026-09-22", "2026-09-21")).toBe("tomorrow");
    expect(dayPhrase("2026-09-23", "2026-09-21")).toBe("Wednesday");
    expect(dayPhrase("2026-09-27", "2026-09-21")).toBe("Sunday");
    // seven days out a bare "Monday" would read as the nearer one
    expect(dayPhrase("2026-09-28", "2026-09-21")).toBe("Monday 28 September");
  });

  it("the finished phrase", () => {
    const next = nextOpening(ist("2026-09-22", "14:00"), OPEN, CLOSE, TUESDAYS);
    expect(opensAtPhrase(next, ist("2026-09-22", "14:00"))).toBe("tomorrow at 11:30 AM");
    const later = nextOpening(ist("2026-09-21", "23:30"), OPEN, CLOSE, TUESDAYS);
    expect(opensAtPhrase(later, ist("2026-09-21", "23:30"))).toBe("Wednesday at 11:30 AM");
  });
});

describe("asapRefusal on a closed day", () => {
  it("Tuesday 14:00: refused, dayOff is set, next opening is Wednesday", () => {
    const refusal = asapRefusal(ist("2026-09-22", "14:00"), shop(TUESDAYS));
    expect(refusal).toMatchObject({ code: "CLOSED", opensDay: "TOMORROW", opensAtLabel: "tomorrow at 11:30 AM", dayOff: { source: "WEEKLY" } });
  });

  it("Monday night: refused by the clock, NOT a day off, and Wednesday is named", () => {
    const refusal = asapRefusal(ist("2026-09-21", "23:30"), shop(TUESDAYS));
    expect(refusal).toMatchObject({ opensDay: "LATER", opensAtLabel: "Wednesday at 11:30 AM", dayOff: null });
  });

  it("carries the public note of a planned closure", () => {
    expect(asapRefusal(ist("2026-09-24", "14:00"), shop(DIWALI))?.dayOff).toEqual({ source: "DATE", note: "Closed for Diwali" });
  });

  it("an open Wednesday proceeds", () => {
    expect(asapRefusal(ist("2026-09-23", "14:00"), shop(TUESDAYS))).toBeNull();
  });
});

describe("the ordering gate and the write gate refuse a closed day", () => {
  it("ASAP on Tuesday is CLOSED; a pause outranks it", () => {
    expect(orderingRefusal(ist("2026-09-22", "14:00"), shop(TUESDAYS), "ASAP")).toMatchObject({ kind: "CLOSED", closed: { dayOff: { source: "WEEKLY" } } });
    const paused = shop(TUESDAYS, { orderingPausedAt: ist("2026-09-22", "10:00"), orderingPausedUntil: null });
    expect(orderingRefusal(ist("2026-09-22", "14:00"), paused, "ASAP")).toMatchObject({ kind: "PAUSED" });
  });

  it("a pre-order for Tuesday is refused at write, even from Monday when the shop is open", () => {
    const now = ist("2026-09-21", "14:00");
    const slot = ist("2026-09-22", "13:00");
    expect(writeGate({ now, shop: shop(TUESDAYS), when: "SCHEDULED", scheduledFor: slot })).toEqual({ kind: "SCHEDULE_SLIPPED" });
    // ...and the same slot with no closures is fine: the closure is what refuses it.
    expect(writeGate({ now, shop: shop(NO_CLOSURES), when: "SCHEDULED", scheduledFor: slot })).toBeNull();
  });

  it("a pre-order for Wednesday from Tuesday is accepted (the closed day itself refuses ASAP only)", () => {
    const now = ist("2026-09-22", "14:00");
    expect(writeGate({ now, shop: shop(TUESDAYS), when: "SCHEDULED", scheduledFor: ist("2026-09-23", "12:00") })).toBeNull();
  });

  it("a closure added between the top gate and the write refuses the slot the top gate accepted", () => {
    const now = ist("2026-09-21", "14:00");
    const slot = ist("2026-09-22", "13:00");
    expect(writeGate({ now, shop: shop(NO_CLOSURES), when: "SCHEDULED", scheduledFor: slot })).toBeNull();
    expect(writeGate({ now, shop: shop({ weeklyClosedDays: [], closedDates: [{ startDate: "2026-09-22", endDate: "2026-09-22", note: null }] }), when: "SCHEDULED", scheduledFor: slot })).toEqual({ kind: "SCHEDULE_SLIPPED" });
  });
});

describe("the picker never offers a slot on a closed day", () => {
  it("Monday evening: today has slots, Tuesday is listed as closed with none", () => {
    const days = scheduleDays(ist("2026-09-21", "20:00"), OPEN, CLOSE, TUESDAYS);
    expect(days.map((d) => [d.date, d.closed, d.slots.length > 0])).toEqual([
      ["2026-09-21", false, true],
      ["2026-09-22", true, false],
    ]);
  });

  it("without closures Tuesday has slots, as before", () => {
    const days = scheduleDays(ist("2026-09-21", "20:00"), OPEN, CLOSE);
    expect(days[1]).toMatchObject({ date: "2026-09-22", closed: false });
    expect(days[1]!.slots.length).toBeGreaterThan(0);
  });

  it("every slot the picker offers passes the server check, and no Tuesday time does", () => {
    const now = ist("2026-09-22", "14:00"); // Tuesday itself: today closed, Wednesday offered
    const days = scheduleDays(now, OPEN, CLOSE, TUESDAYS);
    expect(days[0]).toMatchObject({ closed: true, slots: [] });
    for (const slot of days[1]!.slots) expect(isValidScheduledTime(slot.at, now, OPEN, CLOSE, TUESDAYS)).toBe(true);
    expect(isValidScheduledTime(ist("2026-09-22", "20:00"), now, OPEN, CLOSE, TUESDAYS)).toBe(false);
  });
});

describe("pausedUntilFor — the new switch choices", () => {
  it("UNTIL_NEXT_OPENING skips the day off: Monday night → Wednesday", () => {
    expect(pausedUntilFor("UNTIL_NEXT_OPENING", ist("2026-09-21", "22:00"), OPEN, CLOSE, TUESDAYS)).toEqual(ist("2026-09-23", "11:30"));
  });

  it("REST_OF_TODAY at 9 am is tomorrow's opening, where UNTIL_NEXT_OPENING would be 11:30 today", () => {
    const now = ist("2026-09-21", "09:00");
    expect(pausedUntilFor("UNTIL_NEXT_OPENING", now, OPEN, CLOSE)).toEqual(ist("2026-09-21", "11:30"));
    expect(pausedUntilFor("REST_OF_TODAY", now, OPEN, CLOSE)).toEqual(ist("2026-09-22", "11:30"));
  });

  it("REST_OF_TODAY on Monday with Tuesday off reopens Wednesday", () => {
    expect(pausedUntilFor("REST_OF_TODAY", ist("2026-09-21", "15:00"), OPEN, CLOSE, TUESDAYS)).toEqual(ist("2026-09-23", "11:30"));
  });

  it("UNTIL_DATE reopens at that day's opening, or the next open day when the picked one is closed", () => {
    const now = ist("2026-09-21", "15:00");
    expect(pausedUntilFor("UNTIL_DATE", now, OPEN, CLOSE, NO_CLOSURES, "2026-09-25")).toEqual(ist("2026-09-25", "11:30"));
    expect(pausedUntilFor("UNTIL_DATE", now, OPEN, CLOSE, DIWALI, "2026-09-24")).toEqual(ist("2026-09-26", "11:30"));
  });

  it("UNTIL_DATE can never be earlier than tomorrow, and needs a date", () => {
    const now = ist("2026-09-21", "15:00");
    expect(pausedUntilFor("UNTIL_DATE", now, OPEN, CLOSE, NO_CLOSURES, "2026-09-21")).toEqual(ist("2026-09-22", "11:30"));
    expect(() => pausedUntilFor("UNTIL_DATE", now, OPEN, CLOSE)).toThrow(/needs a date/);
  });

  it("UNTIL_RESUMED has no end", () => {
    expect(pausedUntilFor("UNTIL_RESUMED", ist("2026-09-21", "15:00"), OPEN, CLOSE, TUESDAYS)).toBeNull();
  });
});

describe("the one ordering state on a day off", () => {
  const TUESDAY = ist("2026-09-22", "14:00");

  it("closedByHours with dayOff set; the pre-order path stays open for other days", () => {
    const state = shopOrderingState(TUESDAY, shop(TUESDAYS));
    expect(state).toMatchObject({ state: "closedByHours", reopensAtLabel: "tomorrow at 11:30 AM", dayOff: { source: "WEEKLY" } });
    expect(orderingControls(state)).toMatchObject({ canOrder: true, asapAllowed: false, preorderAllowed: true });
  });

  it("the banner: 'We're closed today. We open again [day] at [time].' plus the public note", () => {
    const planned = shopOrderingState(ist("2026-09-24", "14:00"), shop(DIWALI));
    expect(orderingBanner(planned)).toEqual({ kind: "closed", headline: "We're closed today.", detail: "We open again Saturday at 11:30 AM.", note: "Closed for Diwali" });
  });

  it("the banner on a weekly day off has no note; closed by the clock keeps its old words", () => {
    expect(orderingBanner(shopOrderingState(TUESDAY, shop(TUESDAYS)))).toEqual({ kind: "closed", headline: "We're closed today.", detail: "We open again tomorrow at 11:30 AM.", note: null });
    expect(orderingBanner(shopOrderingState(ist("2026-09-23", "23:30"), shop(TUESDAYS)))).toEqual({ kind: "closed", headline: "We're closed right now.", detail: "We open tomorrow at 11:30 AM.", note: null });
  });

  it("a pause on a day off still shows the paused banner", () => {
    const paused = shop(TUESDAYS, { orderingPausedAt: ist("2026-09-22", "10:00"), orderingPausedUntil: null });
    expect(shopOrderingState(TUESDAY, paused)).toMatchObject({ state: "paused", withinHours: false });
  });
});

describe("the staff pill on a day off", () => {
  const TUESDAY = ist("2026-09-22", "14:00");
  const staff = (state: ReturnType<typeof shopOrderingState>, over: Partial<Record<string, unknown>> = {}): StaffOrderingStatus =>
    ({ ...state, pausedBy: null, reason: null, ordersStillDue: 0, carriedOver: false, preOrdersOnClosedDays: 0, ...over }) as StaffOrderingStatus;

  it("says 'Closed today · opens Wed 11:30 AM' when the next open day is not tomorrow", () => {
    const monday = ist("2026-09-21", "23:30");
    const view = pillView(staff(shopOrderingState(monday, shop(BOTH))), monday);
    // Monday night is closed by the clock, not a day off: no "today".
    expect(view.long).toBe("Closed · opens Fri 11:30 AM");
  });

  it("on the day off itself: 'Closed today · opens tomorrow 11:30 AM' (Wednesday)", () => {
    expect(pillView(staff(shopOrderingState(TUESDAY, shop(TUESDAYS))), TUESDAY)).toMatchObject({ state: "closed", dot: "grey", short: "Closed", long: "Closed today · opens tomorrow 11:30 AM" });
  });

  it("two days off in a row: 'Closed today · opens Thu 11:30 AM'", () => {
    const twoOff: Closures = { weeklyClosedDays: [2, 3], closedDates: [] };
    expect(pillView(staff(shopOrderingState(TUESDAY, shop(twoOff))), TUESDAY).long).toBe("Closed today · opens Thu 11:30 AM");
  });

  it("clockOrTomorrow: same day, tomorrow, weekday within the week, date beyond it", () => {
    const now = ist("2026-09-21", "10:00");
    expect(clockOrTomorrow(ist("2026-09-21", "11:30"), now)).toBe("11:30 AM");
    expect(clockOrTomorrow(ist("2026-09-22", "11:30"), now)).toBe("tomorrow 11:30 AM");
    expect(clockOrTomorrow(ist("2026-09-23", "11:30"), now)).toBe("Wed 11:30 AM");
    expect(clockOrTomorrow(ist("2026-09-27", "11:30"), now)).toBe("Sun 11:30 AM");
    expect(clockOrTomorrow(ist("2026-09-28", "11:30"), now)).toBe("Mon 28 Sep 11:30 AM");
  });

  it("the popover says closed all day, with the note, and lists pre-orders booked for a closed day", () => {
    const now = ist("2026-09-24", "14:00");
    const status = staff(shopOrderingState(now, shop(DIWALI)), { preOrdersOnClosedDays: 2 });
    const detail = pillDetail(status, now, { opens: OPEN, closes: CLOSE }, () => "");
    expect(detail.statusLine).toBe("Closed all day today (Closed for Diwali). Online orders start Sat 11:30 AM.");
    expect(detail.hoursLine).toBe("Today's hours: closed all day");
    expect(detail.closedDayLine).toBe("Pre-orders booked for a closed day: 2. See Admin → Restaurant.");
  });

  it("no pre-order line when there are none", () => {
    const detail = pillDetail(staff(shopOrderingState(TUESDAY, shop(TUESDAYS))), TUESDAY, { opens: OPEN, closes: CLOSE }, () => "");
    expect(detail.closedDayLine).toBeNull();
  });

  it("the signature changes when the day-off state or the pre-order count changes, so a fresh render re-syncs", () => {
    const a = staff(shopOrderingState(TUESDAY, shop(TUESDAYS)));
    expect(statusSignature(a)).not.toBe(statusSignature(staff(shopOrderingState(TUESDAY, shop(TUESDAYS)), { preOrdersOnClosedDays: 1 })));
    expect(statusSignature(a)).not.toBe(statusSignature(staff(shopOrderingState(ist("2026-09-21", "23:30"), shop(TUESDAYS)))));
  });
});
