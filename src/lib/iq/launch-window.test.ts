import { describe, expect, it } from "vitest";
import { startOfBusinessDay } from "@/lib/dates";
import { clampRangeToLaunch, clampSpanToLaunch, isPreLaunch, preLaunchDates } from "./launch-window";

describe("isPreLaunch", () => {
  it("is false with no Opening date set — nothing to exclude yet", () => {
    expect(isPreLaunch("2026-08-01", null)).toBe(false);
  });

  it("is true strictly before the Opening date", () => {
    expect(isPreLaunch("2026-09-09", "2026-09-10")).toBe(true);
  });

  it("is false on the Opening date itself — day one counts as real", () => {
    expect(isPreLaunch("2026-09-10", "2026-09-10")).toBe(false);
  });

  it("is false after the Opening date", () => {
    expect(isPreLaunch("2026-09-11", "2026-09-10")).toBe(false);
  });
});

describe("clampSpanToLaunch", () => {
  const span = { from: "2026-09-01", to: "2026-09-10", label: "test" };

  it("passes the span through unchanged with no Opening date", () => {
    expect(clampSpanToLaunch(span, null, false)).toEqual(span);
  });

  it("passes the span through unchanged when includePreLaunch is true", () => {
    expect(clampSpanToLaunch(span, "2026-09-05", true)).toEqual(span);
  });

  it("passes the span through unchanged when it already starts on or after the Opening date", () => {
    expect(clampSpanToLaunch(span, "2026-08-15", false)).toEqual(span);
    expect(clampSpanToLaunch(span, "2026-09-01", false)).toEqual(span);
  });

  it("moves 'from' to the Opening date when the span straddles it", () => {
    expect(clampSpanToLaunch(span, "2026-09-05", false)).toEqual({ ...span, from: "2026-09-05" });
  });

  it("keeps the Opening date's own day when the span ends exactly on it", () => {
    expect(clampSpanToLaunch({ from: "2026-09-01", to: "2026-09-05", label: "x" }, "2026-09-05", false)).toEqual({ from: "2026-09-05", to: "2026-09-05", label: "x" });
  });

  it("collapses to zero days when the whole span is before the Opening date", () => {
    const result = clampSpanToLaunch(span, "2026-10-01", false);
    expect(result.from > result.to).toBe(true);
  });

  it("preserves extra fields on the span (e.g. 'clamped' on a brief span)", () => {
    const withExtra = { from: "2026-09-01", to: "2026-09-10", clamped: false };
    expect(clampSpanToLaunch(withExtra, "2026-09-05", false)).toEqual({ from: "2026-09-05", to: "2026-09-10", clamped: false });
  });
});

describe("clampRangeToLaunch", () => {
  const range = { from: startOfBusinessDay("2026-09-01"), to: startOfBusinessDay("2026-09-11"), label: "test" };

  it("passes the range through unchanged with no Opening date", () => {
    expect(clampRangeToLaunch(range, null, false)).toEqual(range);
  });

  it("passes the range through unchanged when includePreLaunch is true", () => {
    expect(clampRangeToLaunch(range, "2026-09-05", true)).toEqual(range);
  });

  it("passes the range through unchanged when it already starts on or after the Opening date", () => {
    expect(clampRangeToLaunch(range, "2026-08-15", false)).toEqual(range);
  });

  it("moves 'from' up to the start of the Opening date when the range straddles it", () => {
    const result = clampRangeToLaunch(range, "2026-09-05", false);
    expect(result.from).toEqual(startOfBusinessDay("2026-09-05"));
    expect(result.to).toEqual(range.to);
  });

  it("collapses to zero width when the whole range is before the Opening date", () => {
    const result = clampRangeToLaunch(range, "2026-10-01", false);
    expect(result.from).toEqual(result.to);
  });
});

describe("preLaunchDates", () => {
  it("is empty with no Opening date", () => {
    expect(preLaunchDates(null)).toEqual([]);
  });

  it("lists the days strictly before the Opening date, most recent first, for the default lookback", () => {
    const dates = preLaunchDates("2026-09-10", 3);
    expect(dates).toEqual(["2026-09-09", "2026-09-08", "2026-09-07"]);
  });

  it("never includes the Opening date itself", () => {
    expect(preLaunchDates("2026-09-10", 5)).not.toContain("2026-09-10");
  });

  it("defaults to a lookback that covers an 8-week (56-day) baseline window", () => {
    const dates = preLaunchDates("2026-09-10");
    expect(dates.length).toBeGreaterThanOrEqual(56);
  });
});
