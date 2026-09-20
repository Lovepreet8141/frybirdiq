import { describe, expect, it } from "vitest";
import { formatHours, summariseHours, validateCorrection, weekStart } from "./hours";

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
