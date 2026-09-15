import { describe, expect, it } from "vitest";
import { addDays, businessDate, daysInRange, endOfBusinessDay, openHoursSpan, previousPeriod, resolveRange, startOfBusinessDay, timeOnBusinessDate } from "./index";

describe("business date", () => {
  it("uses Ambala's calendar, not the server's", () => {
    // 20:00 UTC on 10 September is already 01:30 on the 11th in Ambala. A
    // server reading its own clock would file the sale under the wrong day.
    expect(businessDate(new Date("2026-09-10T20:00:00Z"))).toBe("2026-09-11");
    expect(businessDate(new Date("2026-09-10T18:29:00Z"))).toBe("2026-09-10");
    expect(businessDate(new Date("2026-09-10T18:31:00Z"))).toBe("2026-09-11");
  });

  it("starts a day at midnight in Ambala", () => {
    // Midnight IST is 18:30 UTC the previous day.
    expect(startOfBusinessDay("2026-09-10").toISOString()).toBe("2026-09-09T18:30:00.000Z");
    expect(endOfBusinessDay("2026-09-10").toISOString()).toBe("2026-09-10T18:30:00.000Z");
  });

  it("covers exactly 24 hours", () => {
    const span = endOfBusinessDay("2026-09-10").getTime() - startOfBusinessDay("2026-09-10").getTime();
    expect(span).toBe(24 * 60 * 60 * 1000);
  });

  it("shifts across a month and a year end", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("ranges", () => {
  const now = new Date("2026-09-10T12:00:00Z"); // 17:30 IST on the 10th

  it("today runs midnight to midnight in Ambala", () => {
    const range = resolveRange("today", now);
    expect(range.from.toISOString()).toBe("2026-09-09T18:30:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-10T18:30:00.000Z");
  });

  it("seven days includes today, so it is six days back plus today", () => {
    const range = resolveRange("7d", now);
    expect(daysInRange(range)).toHaveLength(7);
    expect(daysInRange(range)[0]).toBe("2026-09-04");
    expect(daysInRange(range).at(-1)).toBe("2026-09-10");
  });

  it("thirty days is thirty days", () => {
    expect(daysInRange(resolveRange("30d", now))).toHaveLength(30);
  });

  it("yesterday is a whole day, not the last 24 hours", () => {
    const range = resolveRange("yesterday", now);
    expect(daysInRange(range)).toEqual(["2026-09-09"]);
  });

  it("compares against an equal span ending where the range starts", () => {
    const range = resolveRange("7d", now);
    const before = previousPeriod(range);
    expect(before.to).toEqual(range.from);
    expect(before.to.getTime() - before.from.getTime()).toBe(range.to.getTime() - range.from.getTime());
  });
});

describe("calendar month ranges", () => {
  it("runs month-to-date from the 1st, not 30 days back", () => {
    // The bug this prevents: rent is paid on the 1st. A rolling 30-day window
    // ending on the 2nd contains two rents and reports a catastrophic month.
    const range = resolveRange("mtd", new Date("2026-03-17T10:00:00+05:30"));
    expect(businessDate(range.from)).toBe("2026-03-01");
    expect(businessDate(new Date(range.to.getTime() - 1))).toBe("2026-03-17");
    expect(range.label).toBe("March 2026 so far");
  });

  it("gives last month its real length, not 30 days", () => {
    const range = resolveRange("lastMonth", new Date("2026-03-17T10:00:00+05:30"));
    expect(businessDate(range.from)).toBe("2026-02-01");
    expect(businessDate(new Date(range.to.getTime() - 1))).toBe("2026-02-28");
    expect(range.label).toBe("February 2026");
  });

  it("gets February right in a leap year", () => {
    const range = resolveRange("lastMonth", new Date("2028-03-05T10:00:00+05:30"));
    expect(businessDate(new Date(range.to.getTime() - 1))).toBe("2028-02-29");
  });

  it("crosses a year boundary backwards", () => {
    const range = resolveRange("lastMonth", new Date("2026-01-09T10:00:00+05:30"));
    expect(businessDate(range.from)).toBe("2025-12-01");
    expect(businessDate(new Date(range.to.getTime() - 1))).toBe("2025-12-31");
    expect(range.label).toBe("December 2025");
  });

  it("covers a 31-day month end to end", () => {
    const range = resolveRange("lastMonth", new Date("2026-02-03T10:00:00+05:30"));
    expect(businessDate(range.from)).toBe("2026-01-01");
    expect(businessDate(new Date(range.to.getTime() - 1))).toBe("2026-01-31");
  });
});

describe("closing time on a business day", () => {
  it("places an HH:MM time on the given business date in Ambala", () => {
    // 20:45 IST is 15:15 UTC the same day.
    expect(timeOnBusinessDate("2026-09-10", "20:45").toISOString()).toBe("2026-09-10T15:15:00.000Z");
    // Midnight is startOfBusinessDay itself.
    expect(timeOnBusinessDate("2026-09-10", "00:00").getTime()).toBe(startOfBusinessDay("2026-09-10").getTime());
  });

  it("spans same-day hours normally", () => {
    expect(openHoursSpan("11:00", "23:00")).toBe(12);
  });

  it("wraps a span that crosses midnight", () => {
    // Opens 18:00, closes 02:00 the next morning — 8 hours, not -16.
    expect(openHoursSpan("18:00", "02:00")).toBe(8);
  });

  it("treats an equal opening and closing time as a full day rather than zero", () => {
    expect(openHoursSpan("09:00", "09:00")).toBe(24);
  });
});
