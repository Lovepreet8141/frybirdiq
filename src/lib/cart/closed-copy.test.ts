import { describe, expect, it } from "vitest";
import { isOpenAt, nextOpening } from "@/lib/orders/opening-hours";
import { clockLabel, closedNoticeText, refusedClosedText } from "./closed-copy";

const ist = (hhmm: string) => new Date(`2026-09-19T${hhmm}:00+05:30`);

describe("notice agrees with the server gate at the boundary", () => {
  it("open at 11:30 sharp (inclusive), closed at 23:00 sharp (exclusive)", () => {
    expect(isOpenAt(ist("11:30"), "11:30", "23:00")).toBe(true);
    expect(isOpenAt(ist("11:29"), "11:30", "23:00")).toBe(false);
    expect(isOpenAt(ist("22:59"), "11:30", "23:00")).toBe(true);
    expect(isOpenAt(ist("23:00"), "11:30", "23:00")).toBe(false);
  });

  it("words the day from nextOpening", () => {
    expect(closedNoticeText(nextOpening(ist("09:00"), "11:30", "23:00").day, "11:30")).toContain("today at 11:30 AM");
    expect(closedNoticeText(nextOpening(ist("23:30"), "11:30", "23:00").day, "11:30")).toContain("tomorrow at 11:30 AM");
  });
});

describe("refusal path", () => {
  it("prints the server's label verbatim and says nothing was charged", () => {
    const text = refusedClosedText({ opensAtLabel: "tomorrow at 11:30 AM" });
    expect(text).toContain("We open tomorrow at 11:30 AM.");
    expect(text).toContain("nothing was charged");
  });

  it("formats clock labels", () => {
    expect(clockLabel("00:05")).toBe("12:05 AM");
    expect(clockLabel("13:00")).toBe("1:00 PM");
  });
});
