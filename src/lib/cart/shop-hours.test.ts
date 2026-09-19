import { describe, expect, it } from "vitest";
import { clockLabel, closedMessage, shopHoursState } from "./shop-hours";

// 2026-09-19 in Asia/Kolkata (+05:30) → UTC instants.
const ist = (hhmm: string) => new Date(`2026-09-19T${hhmm}:00+05:30`);

describe("shopHoursState", () => {
  it("is open between opening and closing", () => {
    expect(shopHoursState(ist("14:00"), "11:30", "23:00")).toEqual({ open: true, closesAt: "23:00" });
    expect(shopHoursState(ist("11:30"), "11:30", "23:00").open).toBe(true);
  });

  it("is closed before opening, and says it opens today", () => {
    expect(shopHoursState(ist("09:00"), "11:30", "23:00")).toEqual({ open: false, opensAt: "11:30", opensToday: true });
  });

  it("is closed at and after closing, and says it opens tomorrow", () => {
    expect(shopHoursState(ist("23:00"), "11:30", "23:00")).toEqual({ open: false, opensAt: "11:30", opensToday: false });
    expect(shopHoursState(ist("23:45"), "11:30", "23:00").open).toBe(false);
  });

  it("reads the business day in IST, not the server's UTC day", () => {
    // 00:30 IST on the 19th is still the 18th in UTC.
    expect(shopHoursState(ist("00:30"), "11:30", "23:00")).toMatchObject({ open: false, opensToday: true });
  });
});

describe("closed message (what the customer is told, and what a refused ASAP order falls back to)", () => {
  it("names the opening time and never promises an order", () => {
    const text = closedMessage({ open: false, opensAt: "11:30", opensToday: true });
    expect(text).toContain("closed");
    expect(text).toContain("today at 11:30 AM");
    expect(closedMessage({ open: false, opensAt: "11:30", opensToday: false })).toContain("tomorrow at 11:30 AM");
  });

  it("formats clock labels", () => {
    expect(clockLabel("00:05")).toBe("12:05 AM");
    expect(clockLabel("13:00")).toBe("1:00 PM");
  });
});

describe("clockLabel agrees with the server's refusal label", () => {
  it("spells the same instant the same way as formatBusinessClock", async () => {
    const { formatBusinessClock } = await import("@/lib/orders/opening-hours");
    expect(clockLabel("11:30")).toBe(formatBusinessClock(new Date("2026-09-19T11:30:00+05:30")));
    expect(clockLabel("23:00")).toBe(formatBusinessClock(new Date("2026-09-19T23:00:00+05:30")));
  });
});
