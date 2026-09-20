import { describe, expect, it } from "vitest";
import { breakMinutes, formatHours, summariseHours, validateBreakCorrection, validateCorrection, weekStart, workedMinutes } from "./hours";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-09-16T12:00:00Z");

describe("summariseHours", () => {
  const rows = [
    { userId: "a", businessDate: "2026-09-14", clockInAt: at("2026-09-14T04:00:00Z"), clockOutAt: at("2026-09-14T12:30:00Z") },
    { userId: "a", businessDate: "2026-09-14", clockInAt: at("2026-09-14T13:00:00Z"), clockOutAt: at("2026-09-14T14:00:00Z") },
    { userId: "a", businessDate: "2026-09-16", clockInAt: at("2026-09-16T10:00:00Z"), clockOutAt: null },
    { userId: "b", businessDate: "2026-09-15", clockInAt: at("2026-09-15T05:00:00Z"), clockOutAt: at("2026-09-15T09:15:00Z") },
  ];
  it("sums minutes per person per business day, counting an open shift up to now", () => {
    const s = summariseHours(rows, NOW);
    expect(s.get("a")?.byDate.get("2026-09-14")).toBe(8 * 60 + 30 + 60);
    expect(s.get("a")?.byDate.get("2026-09-16")).toBe(120);
    expect(s.get("a")?.totalMinutes).toBe(9 * 60 + 30 + 120);
    expect(s.get("b")?.totalMinutes).toBe(255);
  });
  it("never counts negative time", () => {
    const s = summariseHours([{ userId: "a", businessDate: "2026-09-16", clockInAt: at("2026-09-16T13:00:00Z"), clockOutAt: null }], NOW);
    expect(s.get("a")?.totalMinutes).toBe(0);
  });
});

describe("weekStart", () => {
  it("is the Monday on or before the date", () => {
    expect(weekStart("2026-09-16")).toBe("2026-09-14");
    expect(weekStart("2026-09-14")).toBe("2026-09-14");
    expect(weekStart("2026-09-20")).toBe("2026-09-14");
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
  });
});

describe("validateCorrection", () => {
  it("needs out after in, and nothing in the future", () => {
    expect(validateCorrection(at("2026-09-16T05:00:00Z"), at("2026-09-16T04:00:00Z"), NOW).ok).toBe(false);
    expect(validateCorrection(at("2026-09-16T05:00:00Z"), at("2026-09-16T13:00:00Z"), NOW).ok).toBe(false);
    expect(validateCorrection(at("2026-09-16T13:00:00Z"), null, NOW).ok).toBe(false);
    expect(validateCorrection(at("2026-09-16T05:00:00Z"), at("2026-09-16T11:00:00Z"), NOW).ok).toBe(true);
    expect(validateCorrection(at("2026-09-16T05:00:00Z"), null, NOW).ok).toBe(true);
  });
  it("refuses a shift longer than 24 hours as a likely typo", () => {
    expect(validateCorrection(at("2026-09-14T05:00:00Z"), at("2026-09-16T05:00:00Z"), NOW).ok).toBe(false);
  });
});

describe("formatHours", () => {
  it("shows hours and minutes", () => {
    expect(formatHours(0)).toBe("0h 00m");
    expect(formatHours(555)).toBe("9h 15m");
  });
});

import { formatIstLocal, parseIstLocal } from "./hours";

describe("IST local input", () => {
  it("reads a datetime-local value as Ambala time", () => {
    expect(parseIstLocal("2026-09-16T09:30")?.toISOString()).toBe("2026-09-16T04:00:00.000Z");
    expect(parseIstLocal("")).toBeNull();
    expect(parseIstLocal("garbage")).toBeNull();
  });
  it("round-trips through formatIstLocal", () => {
    expect(formatIstLocal(new Date("2026-09-16T04:00:00Z"))).toBe("2026-09-16T09:30");
  });
});

describe("worked time", () => {
  const shift = { clockInAt: at("2026-09-16T04:00:00Z"), clockOutAt: at("2026-09-16T12:00:00Z") };
  it("is shift length minus recorded break time", () => {
    const breaks = [
      { startedAt: at("2026-09-16T07:00:00Z"), endedAt: at("2026-09-16T07:30:00Z") },
      { startedAt: at("2026-09-16T09:00:00Z"), endedAt: at("2026-09-16T09:15:00Z") },
    ];
    expect(breakMinutes(shift, breaks, NOW)).toBe(45);
    expect(workedMinutes(shift, breaks, NOW)).toBe(8 * 60 - 45);
  });
  it("counts an open break up to now, and an open shift up to now", () => {
    const open = { clockInAt: at("2026-09-16T10:00:00Z"), clockOutAt: null };
    expect(workedMinutes(open, [{ startedAt: at("2026-09-16T11:00:00Z"), endedAt: null }], NOW)).toBe(60);
  });
  it("only counts the part of a break that lies inside the shift, and never goes below zero", () => {
    const breaks = [{ startedAt: at("2026-09-16T11:30:00Z"), endedAt: at("2026-09-16T13:00:00Z") }];
    expect(breakMinutes(shift, breaks, NOW)).toBe(30);
    expect(workedMinutes({ clockInAt: shift.clockInAt, clockOutAt: at("2026-09-16T04:10:00Z") }, [{ startedAt: shift.clockInAt, endedAt: at("2026-09-16T05:00:00Z") }], NOW)).toBe(0);
  });
  it("summariseHours reports worked time, breaks removed", () => {
    const s = summariseHours([{ userId: "a", businessDate: "2026-09-16", ...shift, breaks: [{ startedAt: at("2026-09-16T07:00:00Z"), endedAt: at("2026-09-16T08:00:00Z") }] }], NOW);
    expect(s.get("a")?.totalMinutes).toBe(7 * 60);
  });
});

describe("validateBreakCorrection", () => {
  const shift = { clockInAt: at("2026-09-16T04:00:00Z"), clockOutAt: at("2026-09-16T12:00:00Z") };
  it("keeps a break inside its shift, in order, not in the future", () => {
    expect(validateBreakCorrection(shift, at("2026-09-16T06:00:00Z"), at("2026-09-16T06:30:00Z"), NOW).ok).toBe(true);
    expect(validateBreakCorrection(shift, at("2026-09-16T03:00:00Z"), at("2026-09-16T06:30:00Z"), NOW).ok).toBe(false);
    expect(validateBreakCorrection(shift, at("2026-09-16T06:00:00Z"), at("2026-09-16T13:00:00Z"), NOW).ok).toBe(false);
    expect(validateBreakCorrection(shift, at("2026-09-16T06:30:00Z"), at("2026-09-16T06:00:00Z"), NOW).ok).toBe(false);
    expect(validateBreakCorrection({ ...shift, clockOutAt: null }, at("2026-09-16T11:00:00Z"), at("2026-09-16T12:30:00Z"), NOW).ok).toBe(false);
  });
});
