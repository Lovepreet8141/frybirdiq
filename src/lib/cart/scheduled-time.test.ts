import { describe, expect, it } from "vitest";
import { isValidScheduledTime, MIN_LEAD_MINUTES, scheduleDays } from "./scheduled-time";

// FRYBIRD's real hours throughout: 11:30–23:00 IST.
const OPENING = "11:30";
const CLOSING = "23:00";

describe("scheduleDays", () => {
  it("offers today and tomorrow", () => {
    const now = new Date("2026-09-15T10:00:00Z"); // 15:30 IST
    const days = scheduleDays(now, OPENING, CLOSING);
    expect(days).toHaveLength(2);
    expect(days[0]!.label).toBe("Today");
    expect(days[1]!.label).toBe("Tomorrow");
  });

  it("mid-service: today's slots start at least the lead time from now, on the slot grid", () => {
    const now = new Date("2026-09-15T10:00:00Z"); // 15:30 IST
    const [today] = scheduleDays(now, OPENING, CLOSING);
    const first = today!.slots[0]!;
    expect(first.at.getTime()).toBeGreaterThanOrEqual(now.getTime() + MIN_LEAD_MINUTES * 60_000);
    // On the 15-minute grid.
    expect(first.at.getTime() % (15 * 60_000)).toBe(0);
  });

  it("before opening: today's first slot is opening time, not now + lead", () => {
    const now = new Date("2026-09-15T04:00:00Z"); // 09:30 IST — before 11:30 opening
    const [today] = scheduleDays(now, OPENING, CLOSING);
    const first = today!.slots[0]!;
    expect(first.label).toBe("11:30 AM");
  });

  it("date rollover: right at closing, today has no slots left and tomorrow does", () => {
    const now = new Date("2026-09-15T17:29:00Z"); // 22:59 IST — one minute before close
    const [today, tomorrow] = scheduleDays(now, OPENING, CLOSING);
    expect(today!.slots).toHaveLength(0);
    expect(tomorrow!.slots.length).toBeGreaterThan(0);
    expect(tomorrow!.slots[0]!.label).toBe("11:30 AM");
  });

  it("date rollover: after closing, today has no slots left", () => {
    const now = new Date("2026-09-15T18:00:00Z"); // 23:30 IST — after close
    const [today] = scheduleDays(now, OPENING, CLOSING);
    expect(today!.slots).toHaveLength(0);
  });

  it("no slot ever falls at or after closing time", () => {
    const now = new Date("2026-09-15T10:00:00Z");
    const days = scheduleDays(now, OPENING, CLOSING);
    for (const day of days) {
      const closing = day.date === "2026-09-15" ? new Date("2026-09-15T17:30:00Z") : new Date("2026-09-16T17:30:00Z");
      for (const slot of day.slots) expect(slot.at.getTime()).toBeLessThan(closing.getTime());
    }
  });
});

describe("isValidScheduledTime", () => {
  const now = new Date("2026-09-15T10:00:00Z"); // 15:30 IST, mid-service

  it("accepts a valid future time within hours and past the lead time", () => {
    const candidate = new Date("2026-09-15T12:00:00Z"); // 17:30 IST
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(true);
  });

  it("rejects a time in the past", () => {
    const candidate = new Date("2026-09-15T09:00:00Z"); // before now
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(false);
  });

  it("rejects a time inside now but before the minimum lead", () => {
    const candidate = new Date(now.getTime() + 5 * 60_000); // 5 minutes out, lead is 20
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(false);
  });

  it("accepts a time exactly at the minimum lead boundary", () => {
    const candidate = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(true);
  });

  it("rejects a time before opening", () => {
    const candidate = new Date("2026-09-15T05:00:00Z"); // 10:30 IST — before 11:30 opening
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(false);
  });

  it("rejects a time at or after closing", () => {
    const candidate = new Date("2026-09-15T17:30:00Z"); // 23:00 IST exactly — closing, not before it
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(false);
  });

  it("accepts a time one minute before closing", () => {
    const candidate = new Date("2026-09-15T17:29:00Z"); // 22:59 IST
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(true);
  });

  it("accepts a valid time tomorrow", () => {
    const candidate = new Date("2026-09-16T06:00:00Z"); // 11:30 IST tomorrow, opening
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(true);
  });

  it("rejects a time beyond the scheduling horizon (day after tomorrow)", () => {
    const candidate = new Date("2026-09-17T06:00:00Z");
    expect(isValidScheduledTime(candidate, now, OPENING, CLOSING)).toBe(false);
  });

  it("handles the date rollover at the IST day boundary correctly — just after midnight IST is 'tomorrow', not 'today'", () => {
    const lateNight = new Date("2026-09-15T19:00:00Z"); // 00:30 IST on the 16th
    const candidate = new Date("2026-09-16T06:00:00Z"); // 11:30 IST on the 16th — "today" relative to lateNight
    expect(isValidScheduledTime(candidate, lateNight, OPENING, CLOSING)).toBe(true);
  });

  it("rejects Not a Date / invalid input", () => {
    expect(isValidScheduledTime(new Date(Number.NaN), now, OPENING, CLOSING)).toBe(false);
  });
});
