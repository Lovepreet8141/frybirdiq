import { describe, expect, it } from "vitest";

import {
  MANUAL_RERUN_MAX_DAYS,
  PERIOD_KINDS,
  checkManualPeriod,
  periodBounds,
  periodKeyAt,
  scheduledPeriods,
  shiftPeriod,
  targetPeriod,
} from "./period";

const utc = (s: string) => new Date(s);

describe("period keys are IST, around midnight", () => {
  it("rolls the day and hour at 18:30 UTC, not 00:00 UTC", () => {
    const before = utc("2026-09-16T18:29:59.999Z");
    const at = utc("2026-09-16T18:30:00.000Z");
    expect(periodKeyAt("day", before)).toBe("2026-09-16");
    expect(periodKeyAt("hour", before)).toBe("2026-09-16T23");
    expect(periodKeyAt("day", at)).toBe("2026-09-17");
    expect(periodKeyAt("hour", at)).toBe("2026-09-17T00");
  });

  it("floors to the IST quarter hour, which lines up with UTC quarters (+05:30)", () => {
    expect(periodKeyAt("quarter_hour", utc("2026-09-16T18:29:59.999Z"))).toBe("2026-09-16T23:45");
    expect(periodKeyAt("quarter_hour", utc("2026-09-16T18:30:00Z"))).toBe("2026-09-17T00:00");
    expect(periodKeyAt("quarter_hour", utc("2026-09-17T04:44:59Z"))).toBe("2026-09-17T10:00");
    expect(periodKeyAt("quarter_hour", utc("2026-09-17T04:45:00Z"))).toBe("2026-09-17T10:15");
    expect(periodBounds("quarter_hour", "2026-09-17T10:15")).toEqual({ start: utc("2026-09-17T04:45:00Z"), end: utc("2026-09-17T05:00:00Z") });
    expect(periodBounds("quarter_hour", "2026-09-17T10:10")).toBeNull();
    expect(shiftPeriod("quarter_hour", "2026-09-17T00:00", -1)).toBe("2026-09-16T23:45");
  });

  it("keeps a UTC-midnight instant on the IST day it already is", () => {
    expect(periodKeyAt("day", utc("2026-09-17T00:00:00Z"))).toBe("2026-09-17");
    expect(periodKeyAt("hour", utc("2026-09-17T00:00:00Z"))).toBe("2026-09-17T05");
  });

  it("rolls the ISO week at Monday midnight IST", () => {
    expect(periodKeyAt("week", utc("2026-09-13T18:29:59Z"))).toBe("2026-W37");
    expect(periodKeyAt("week", utc("2026-09-13T18:30:00Z"))).toBe("2026-W38");
  });

  it("handles ISO week years across new year", () => {
    expect(periodKeyAt("week", utc("2025-12-28T18:30:00Z"))).toBe("2026-W01"); // Mon 2025-12-29 IST
    expect(periodKeyAt("week", utc("2026-12-31T06:00:00Z"))).toBe("2026-W53");
    expect(periodKeyAt("week", utc("2027-01-03T18:29:59Z"))).toBe("2026-W53"); // Sun 2027-01-03 IST
    expect(periodKeyAt("week", utc("2027-01-03T18:30:00Z"))).toBe("2027-W01");
  });
});

describe("bounds", () => {
  it("gives IST starts as UTC instants, end exclusive", () => {
    expect(periodBounds("day", "2026-09-17")).toEqual({
      start: utc("2026-09-16T18:30:00Z"),
      end: utc("2026-09-17T18:30:00Z"),
    });
    expect(periodBounds("hour", "2026-09-17T00")).toEqual({
      start: utc("2026-09-16T18:30:00Z"),
      end: utc("2026-09-16T19:30:00Z"),
    });
    expect(periodBounds("week", "2027-W01")).toEqual({
      start: utc("2027-01-03T18:30:00Z"),
      end: utc("2027-01-10T18:30:00Z"),
    });
  });

  it.each([
    ["day", "2026-02-30"],
    ["day", "2026-9-17"],
    ["hour", "2026-09-17T24"],
    ["hour", "2026-09-17"],
    ["week", "2026-W54"],
    ["week", "2027-W53"],
    ["week", "2026-W00"],
    ["day", " 2026-09-17"],
  ] as const)("rejects %s key %j", (kind, key) => {
    expect(periodBounds(kind, key)).toBeNull();
  });

  it("round-trips every key it produces", () => {
    for (const kind of PERIOD_KINDS) {
      for (let h = 0; h < 24 * 400; h += 7) {
        const at = new Date(utc("2026-01-01T00:00:00Z").getTime() + h * 3600_000);
        const key = periodKeyAt(kind, at);
        const bounds = periodBounds(kind, key)!;
        expect(bounds.start.getTime()).toBeLessThanOrEqual(at.getTime());
        expect(bounds.end.getTime()).toBeGreaterThan(at.getTime());
      }
    }
  });
});

describe("shifting and scheduling", () => {
  it("steps across day, month and ISO-year edges", () => {
    expect(shiftPeriod("hour", "2026-09-17T00", -1)).toBe("2026-09-16T23");
    expect(shiftPeriod("day", "2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftPeriod("week", "2027-W01", -1)).toBe("2026-W53");
    expect(() => shiftPeriod("day", "nope", 1)).toThrow();
  });

  it("targets the current or the previous period", () => {
    const now = utc("2026-09-16T21:30:00Z"); // 03:00 IST on the 17th
    expect(targetPeriod("day", "previous", now)).toBe("2026-09-16");
    expect(targetPeriod("hour", "current", now)).toBe("2026-09-17T03");
  });

  it("lists catch-up periods oldest first, ending at the target", () => {
    const now = utc("2026-09-16T21:30:00Z");
    expect(scheduledPeriods("day", "previous", 2, now)).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
    expect(scheduledPeriods("hour", "current", 0, now)).toEqual(["2026-09-17T03"]);
  });
});

describe("manual re-run", () => {
  const now = utc("2026-09-17T04:00:00Z"); // 09:30 IST

  it("accepts a real past period within 14 days", () => {
    expect(checkManualPeriod("day", "previous", "2026-09-16", now)).toEqual({ ok: true, key: "2026-09-16" });
    expect(checkManualPeriod("day", "previous", "2026-09-04", now)).toEqual({ ok: true, key: "2026-09-04" });
  });

  it("refuses malformed, future and too-old periods", () => {
    expect(checkManualPeriod("day", "previous", "2026-09-17T00", now)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(checkManualPeriod("day", "previous", "2026-09-17", now)).toEqual({ ok: false, reason: "IN_FUTURE" });
    expect(checkManualPeriod("hour", "current", "2026-09-17T10", now)).toEqual({ ok: false, reason: "IN_FUTURE" });
    expect(checkManualPeriod("day", "previous", "2026-09-02", now)).toEqual({ ok: false, reason: "TOO_OLD" });
    expect(MANUAL_RERUN_MAX_DAYS).toBe(14);
  });
});
