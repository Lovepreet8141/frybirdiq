import { describe, expect, it } from "vitest";
import { PAUSE_MODE_OPTIONS, PAUSE_UNTIL_MAX_DAYS, restartSentence, untilDateBounds, untilDateProblem } from "./pause-duration";

const NOW = new Date("2026-09-21T09:00:00+05:30");
const labels = { nextOpeningLabel: "today at 11:30 AM", restOfTodayLabel: "tomorrow at 11:30 AM", untilDateLabel: null };

describe("the four choices", () => {
  it("in the owner's words, default first", () => {
    expect(PAUSE_MODE_OPTIONS.map((o) => o.label)).toEqual(["Until we next open", "Closed for the rest of today", "Closed until a date I pick", "Until I switch it back on"]);
    expect(PAUSE_MODE_OPTIONS[0]?.mode).toBe("UNTIL_NEXT_OPENING");
  });
});

describe("restartSentence", () => {
  it("each choice reads its own label: at 9 am the default is TODAY, rest of today is tomorrow", () => {
    expect(restartSentence("UNTIL_NEXT_OPENING", labels)).toBe("Orders restart today at 11:30 AM.");
    expect(restartSentence("REST_OF_TODAY", labels)).toBe("Orders restart tomorrow at 11:30 AM.");
  });
  it("a date choice says nothing until a date is picked, then the server's label", () => {
    expect(restartSentence("UNTIL_DATE", labels)).toBeNull();
    expect(restartSentence("UNTIL_DATE", { ...labels, untilDateLabel: "Saturday at 11:30 AM" })).toBe("Orders restart Saturday at 11:30 AM.");
  });
  it("manual has no time", () => {
    expect(restartSentence("UNTIL_RESUMED", labels)).toBe("Orders stay off until someone switches them back on.");
  });
});

describe("untilDateProblem", () => {
  it("tomorrow to 60 days ahead is fine", () => {
    expect(untilDateBounds(NOW)).toEqual({ min: "2026-09-22", max: "2026-11-20" });
    expect(untilDateProblem("2026-09-22", NOW)).toBeNull();
    expect(untilDateProblem("2026-11-20", NOW)).toBeNull();
  });
  it("today, the past, beyond the window, junk and a missing date are refused", () => {
    expect(untilDateProblem("2026-09-21", NOW)).toMatch(/after today/);
    expect(untilDateProblem("2026-09-01", NOW)).toMatch(/after today/);
    expect(untilDateProblem("2026-11-21", NOW)).toMatch(new RegExp(`within ${PAUSE_UNTIL_MAX_DAYS} days`));
    expect(untilDateProblem("2026-02-30", NOW)).toMatch(/real date/);
    expect(untilDateProblem("soon", NOW)).toMatch(/Pick the date/);
    expect(untilDateProblem(undefined, NOW)).toMatch(/Pick the date/);
  });
});
