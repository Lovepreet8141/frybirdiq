import { describe, expect, it } from "vitest";
import { dayAndClock, restartLine, sinceLabel, stillDueLine } from "./close-shop-copy";

// 2026-09-20 in Ambala (IST = UTC+5:30)
const at = (hhmm: string, day = "2026-09-20") => new Date(`${day}T${hhmm}:00+05:30`);

describe("restartLine", () => {
  it("before opening, 'until we next open' says today at opening — the 9 am fryer case", () => {
    expect(restartLine("UNTIL_NEXT_OPENING", at("09:00"), "11:30", "23:00")).toBe("Orders restart today at 11:30 AM.");
  });
  it("during hours it says tomorrow", () => {
    expect(restartLine("UNTIL_NEXT_OPENING", at("19:42"), "11:30", "23:00")).toBe("Orders restart tomorrow at 11:30 AM.");
  });
  it("manual mode never names a time", () => {
    expect(restartLine("UNTIL_RESUMED", at("19:42"), "11:30", "23:00")).toBe("Orders stay off until you switch them back on.");
  });
});

describe("sinceLabel", () => {
  it("names today, yesterday, then the date", () => {
    const now = at("10:00");
    expect(sinceLabel(at("07:42"), now)).toBe("today at 7:42 AM");
    expect(sinceLabel(at("19:42", "2026-09-19"), now)).toBe("yesterday at 7:42 PM");
    expect(sinceLabel(at("19:42", "2026-09-10"), now)).toBe("2026-09-10 at 7:42 PM");
  });
});

it("dayAndClock uses the Ambala day, not the server's", () => {
  // 00:30 IST on the 21st is still the 20th in UTC
  expect(dayAndClock(at("11:30", "2026-09-21"), at("00:30", "2026-09-21"))).toBe("today at 11:30 AM");
});

describe("stillDueLine", () => {
  it("is null for none, singular for one, plural otherwise", () => {
    expect(stillDueLine(0)).toBeNull();
    expect(stillDueLine(1)).toMatch(/^1 order is already placed/);
    expect(stillDueLine(3)).toMatch(/^3 orders are already placed/);
  });
});
