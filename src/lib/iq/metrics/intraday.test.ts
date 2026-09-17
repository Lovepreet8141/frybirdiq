import { describe, expect, it } from "vitest";

import { addDays, businessDate, startOfBusinessDay } from "./business-day";
import {
  BUCKET_MS,
  INTRADAY_BACKFILL_DAYS,
  INTRADAY_METRICS,
  INTRADAY_METRIC_IDS,
  INTRADAY_RETENTION_DAYS,
  bucketStartOf,
  intradayBackfillDates,
  intradayRetentionFirstDate,
} from "./intraday";

describe("intraday buckets", () => {
  it("floors an instant to its 15-minute bucket", () => {
    expect(bucketStartOf(new Date("2026-09-10T06:44:59.999Z")).toISOString()).toBe("2026-09-10T06:30:00.000Z");
    expect(bucketStartOf(new Date("2026-09-10T06:45:00.000Z")).toISOString()).toBe("2026-09-10T06:45:00.000Z");
  });

  it("starts the first bucket of an IST day at IST midnight, and keeps 23:59:59.999 IST on its own day", () => {
    const midnight = startOfBusinessDay("2026-09-10");
    expect(bucketStartOf(midnight).getTime()).toBe(midnight.getTime());
    const lastInstant = new Date(midnight.getTime() + 24 * 60 * 60 * 1000 - 1);
    expect(businessDate(bucketStartOf(lastInstant))).toBe("2026-09-10");
    expect(bucketStartOf(lastInstant).getTime() % BUCKET_MS).toBe(0);
  });
});

describe("retention and backfill (C7)", () => {
  it("keeps 63 days, today included", () => {
    expect(INTRADAY_RETENTION_DAYS).toBe(63);
    expect(intradayRetentionFirstDate("2026-09-17")).toBe("2026-07-17");
  });

  it("backfills 56 days, oldest first, ending the day before today", () => {
    const dates = intradayBackfillDates("2026-09-17");
    expect(dates).toHaveLength(INTRADAY_BACKFILL_DAYS);
    expect(dates[0]).toBe("2026-07-23");
    expect(dates.at(-1)).toBe("2026-09-16");
    expect([...dates].sort()).toEqual(dates);
  });

  it.each(["2026-01-01", "2026-03-01", "2026-09-17", "2028-02-29", "2026-12-31"])("never backfills a date the purge would delete, for %s", (today) => {
    const first = intradayBackfillDates(today)[0]!;
    expect(first > intradayRetentionFirstDate(today)).toBe(true);
    // A backfill that resumes across midnight is still inside the next day's retention.
    expect(first > intradayRetentionFirstDate(addDays(today, 1))).toBe(true);
  });
});

describe("intraday metric definitions", () => {
  it("has one definition per id, in the fact table's units", () => {
    for (const id of INTRADAY_METRIC_IDS) {
      expect(INTRADAY_METRICS[id].id).toBe(id);
      expect(["paise", "count"]).toContain(INTRADAY_METRICS[id].unit);
      expect(id).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });
});
