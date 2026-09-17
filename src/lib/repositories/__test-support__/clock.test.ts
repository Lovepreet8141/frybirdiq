import { describe, expect, it } from "vitest";
import { businessDate } from "@/lib/dates";
import { istInstant, monthStart } from "./clock";

describe("istInstant", () => {
  it("puts the last millisecond of an IST day on that day, though its UTC date differs", () => {
    const at = istInstant("2026-08-31", "23:59:59.999");
    expect(at.toISOString()).toBe("2026-08-31T18:29:59.999Z");
    expect(businessDate(at)).toBe("2026-08-31");
  });

  it("puts IST midnight and 00:10 on the new day, while UTC still reads the day before", () => {
    const midnight = istInstant("2026-09-01", "00:00");
    expect(midnight.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(businessDate(midnight)).toBe("2026-09-01");
    expect(businessDate(istInstant("2026-09-01", "00:10"))).toBe("2026-09-01");
  });

  it("defaults to IST noon", () => {
    expect(istInstant("2026-09-10").toISOString()).toBe("2026-09-10T06:30:00.000Z");
  });

  it("refuses dates and times that do not exist", () => {
    expect(() => istInstant("2026-02-30")).toThrow(/real date/);
    expect(() => istInstant("2026-9-1")).toThrow(/YYYY-MM-DD/);
    expect(() => istInstant("2026-09-01", "24:00")).toThrow(/time of day/);
    expect(() => istInstant("2026-09-01", "12:60")).toThrow(/time of day/);
    expect(() => istInstant("2026-09-01", "noon")).toThrow(/HH:MM/);
  });
});

describe("monthStart", () => {
  it("normalises a month or its first day", () => {
    expect(monthStart("2026-09")).toBe("2026-09-01");
    expect(monthStart("2026-09-01")).toBe("2026-09-01");
  });

  it("takes an instant's IST month, not its UTC month", () => {
    expect(monthStart(istInstant("2026-09-01", "00:10"))).toBe("2026-09-01");
    expect(monthStart(istInstant("2026-08-31", "23:59:59.999"))).toBe("2026-08-01");
  });

  it("refuses anything that is not a month", () => {
    expect(() => monthStart("2026-13")).toThrow(/not a month/);
    expect(() => monthStart("2026-09-15")).toThrow(/not a month/);
  });
});
