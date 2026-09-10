import { describe, expect, it } from "vitest";
import { addDays, businessDate, daysInRange, endOfBusinessDay, previousPeriod, resolveRange, startOfBusinessDay } from "./index";

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
