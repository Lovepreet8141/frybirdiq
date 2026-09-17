import { describe, expect, it } from "vitest";

import * as dates from "@/lib/dates";

import { BUSINESS_TIMEZONE, businessDate, businessDateSql, businessWeek, endOfBusinessDay, startOfBusinessDay } from "./business-day";

/**
 * An independent model of what Postgres computes for
 * `(ts AT TIME ZONE 'Asia/Kolkata')::date` on a timestamptz: shift the instant
 * by IST's fixed +05:30 (India has no DST) and take the calendar date. Kept in
 * the test on purpose — it is the reference, not production logic.
 */
function referenceIstDate(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

describe("re-exports", () => {
  it("are src/lib/dates itself, not copies", () => {
    expect(businessDate).toBe(dates.businessDate);
    expect(startOfBusinessDay).toBe(dates.startOfBusinessDay);
    expect(endOfBusinessDay).toBe(dates.endOfBusinessDay);
    expect(BUSINESS_TIMEZONE).toBe("Asia/Kolkata");
  });
});

describe("businessDateSql", () => {
  it("renders the IST date expression for a column", () => {
    expect(businessDateSql("created_at")).toBe("(created_at AT TIME ZONE 'Asia/Kolkata')::date");
    expect(businessDateSql("o.occurred_at")).toBe("(o.occurred_at AT TIME ZONE 'Asia/Kolkata')::date");
  });

  it("refuses anything that is not a plain column reference", () => {
    for (const bad of ["", "created_at; drop table orders", "now()", "a.b.c", "Created_At", "x'y", "1col"]) {
      expect(() => businessDateSql(bad)).toThrow(RangeError);
    }
  });
});

describe("TS businessDate agrees with the SQL expression's reference around IST midnight", () => {
  const cases: readonly [string, string][] = [
    ["2026-09-10T18:29:59.999Z", "2026-09-10"], // 23:59:59.999 IST
    ["2026-09-10T18:30:00.000Z", "2026-09-11"], // 00:00 IST
    ["2026-09-10T18:30:00.001Z", "2026-09-11"],
    ["2026-09-10T18:40:00.000Z", "2026-09-11"], // 00:10 IST
    ["2026-08-31T18:29:59.999Z", "2026-08-31"], // month boundary (D4)
    ["2026-08-31T18:30:00.000Z", "2026-09-01"],
    ["2025-12-31T18:30:00.000Z", "2026-01-01"], // year boundary
    ["2028-02-28T18:30:00.000Z", "2028-02-29"], // leap day
    ["2026-09-10T00:00:00.000Z", "2026-09-10"], // UTC midnight is 05:30 IST, same day
    ["2026-09-09T23:59:59.999Z", "2026-09-10"], // UTC date differs from IST date
  ];

  it.each(cases)("%s is business date %s", (iso, expected) => {
    const at = new Date(iso);
    expect(businessDate(at)).toBe(expected);
    expect(referenceIstDate(at)).toBe(expected);
  });

  it("agrees minute by minute across a whole day either side of 18:30Z", () => {
    const from = Date.parse("2026-08-31T06:30:00Z");
    for (let t = from; t < from + 24 * 60 * 60_000; t += 60_000) {
      const at = new Date(t);
      expect(businessDate(at)).toBe(referenceIstDate(at));
    }
  });

  it("buckets the start and end instants of a business day correctly", () => {
    const day = "2026-09-01";
    expect(businessDate(startOfBusinessDay(day))).toBe(day);
    expect(referenceIstDate(startOfBusinessDay(day))).toBe(day);
    expect(businessDate(new Date(endOfBusinessDay(day).getTime() - 1))).toBe(day);
    expect(businessDate(endOfBusinessDay(day))).toBe("2026-09-02");
  });
});

describe("businessWeek (Mon–Sun IST)", () => {
  it("runs Monday to Sunday", () => {
    // 2026-09-14 is a Monday.
    expect(businessWeek("2026-09-14")).toEqual({ start: "2026-09-14", end: "2026-09-20" });
    expect(businessWeek("2026-09-17")).toEqual({ start: "2026-09-14", end: "2026-09-20" });
    expect(businessWeek("2026-09-20")).toEqual({ start: "2026-09-14", end: "2026-09-20" });
    expect(businessWeek("2026-09-21")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  });

  it("crosses month and year ends", () => {
    expect(businessWeek("2026-09-01")).toEqual({ start: "2026-08-31", end: "2026-09-06" });
    expect(businessWeek("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });

  it("names the week of the IST date, not the UTC one", () => {
    // Sunday 20 Sep 23:30 IST = 18:00Z; Monday 21 Sep 00:30 IST = 19:00Z the same UTC day.
    expect(businessWeek(businessDate(new Date("2026-09-20T18:00:00Z"))).start).toBe("2026-09-14");
    expect(businessWeek(businessDate(new Date("2026-09-20T19:00:00Z"))).start).toBe("2026-09-21");
  });

  it("rejects a non-date", () => {
    expect(() => businessWeek("2026-9-1")).toThrow(RangeError);
  });
});
