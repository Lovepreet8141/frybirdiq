import { describe, expect, it } from "vitest";
import { CLOSED_DATE_MAX_RUN_DAYS, CLOSED_DATE_NOTE_MAX, closedDateProblem, isRealDate } from "./closed-date-rules";

const TODAY = "2026-09-21";

describe("closedDateProblem", () => {
  it("a single day, a range, today itself and a note are fine", () => {
    expect(closedDateProblem("2026-10-20", "2026-10-20", "Closed for Diwali", TODAY)).toBeNull();
    expect(closedDateProblem("2026-10-20", "2026-10-23", null, TODAY)).toBeNull();
    expect(closedDateProblem(TODAY, TODAY, null, TODAY)).toBeNull();
  });
  it("a range that has already ended, or ends before it starts, is refused", () => {
    expect(closedDateProblem("2026-09-10", "2026-09-12", null, TODAY)).toBe("That date has already passed.");
    expect(closedDateProblem("2026-10-20", "2026-10-19", null, TODAY)).toMatch(/can't be before/);
  });
  it("a range that started already but has not ended is fine (a closure in progress)", () => {
    expect(closedDateProblem("2026-09-19", "2026-09-23", null, TODAY)).toBeNull();
  });
  it("a year ahead at most, a month at a time", () => {
    expect(closedDateProblem("2027-09-21", "2027-09-21", null, TODAY)).toBeNull();
    expect(closedDateProblem("2027-09-22", "2027-09-22", null, TODAY)).toMatch(/a year ahead/);
    expect(closedDateProblem("2026-10-01", `2026-10-${CLOSED_DATE_MAX_RUN_DAYS}`, null, TODAY)).toBeNull();
    expect(closedDateProblem("2026-10-01", "2026-11-01", null, TODAY)).toMatch(/up to 31 days/);
  });
  it("the note is capped and never empty when given", () => {
    expect(closedDateProblem("2026-10-20", "2026-10-20", "x".repeat(CLOSED_DATE_NOTE_MAX), TODAY)).toBeNull();
    expect(closedDateProblem("2026-10-20", "2026-10-20", "x".repeat(CLOSED_DATE_NOTE_MAX + 1), TODAY)).toMatch(/120 characters/);
    expect(closedDateProblem("2026-10-20", "2026-10-20", "", TODAY)).toMatch(/120 characters/);
  });
  it("real dates only", () => {
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(closedDateProblem("2026-13-01", "2026-13-01", null, TODAY)).toBe("Pick a real date.");
  });
});
