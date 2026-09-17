import { describe, expect, it } from "vitest";

import { TRAILING_DAYS, dateOfPeriodKey, datesBetween, nightlyDates, parityRanges, remainingAfter } from "./facts-plan";

describe("facts job date planning (IQ-1 DESIGN; REVIEW required change 2)", () => {
  it("lists days inclusively, oldest first, across month and year ends", () => {
    expect(datesBetween("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(datesBetween("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(datesBetween("2026-09-02", "2026-09-01")).toEqual([]);
  });

  it("recomputes all of the current and previous month when that reaches further back than 35 days", () => {
    const dates = nightlyDates("2026-09-16");
    expect(dates[0]).toBe("2026-08-01");
    expect(dates.at(-1)).toBe("2026-09-16");
    expect(dates).toHaveLength(47);
  });

  it("never covers fewer than the trailing 35 days early in a month", () => {
    const dates = nightlyDates("2026-03-01"); // previous month is a 28-day February
    expect(dates[0]).toBe("2026-01-26");
    expect(dates).toHaveLength(TRAILING_DAYS);
    expect(dates).toContain("2026-02-01");
  });

  it("crosses the year end", () => {
    const dates = nightlyDates("2027-01-05");
    expect(dates[0]).toBe("2026-12-01");
    expect(dates.at(-1)).toBe("2027-01-05");
  });

  it("checks the whole previous month and the current month to date", () => {
    expect(parityRanges("2026-09-16")).toEqual([
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-09-01", to: "2026-09-16" },
    ]);
    expect(parityRanges("2026-03-01")).toEqual([
      { from: "2026-02-01", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-01" },
    ]);
  });

  it("resumes after the last committed day", () => {
    const dates = datesBetween("2026-09-01", "2026-09-05");
    expect(remainingAfter(dates, null)).toEqual(dates);
    expect(remainingAfter(dates, "2026-09-03")).toEqual(["2026-09-04", "2026-09-05"]);
    expect(remainingAfter(dates, "2026-09-05")).toEqual([]);
  });

  it("reads the business date from a day or quarter-hour period key", () => {
    expect(dateOfPeriodKey("2026-09-17")).toBe("2026-09-17");
    expect(dateOfPeriodKey("2026-09-17T10:15")).toBe("2026-09-17");
  });
});
