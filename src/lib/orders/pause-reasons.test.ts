import { describe, expect, it } from "vitest";
import { PAUSE_NOTE_MAX, PAUSE_REASON_PRESETS, composePauseReason, noteProblem } from "./pause-reasons";

describe("pause reasons", () => {
  it("offers exactly the owner's five, in the owner's words and order", () => {
    expect([...PAUSE_REASON_PRESETS]).toEqual(["Too busy", "Out of stock", "Equipment problem", "Staff shortage", "Other"]);
  });

  it("a preset alone is the whole reason (the note is optional)", () => {
    expect(composePauseReason("Too busy", undefined)).toBe("Too busy");
    expect(composePauseReason("Other", "   ")).toBe("Other");
  });

  it("a note is appended after the preset", () => {
    expect(composePauseReason("Equipment problem", " fryer 2 is down ")).toBe("Equipment problem: fryer 2 is down");
  });

  it("the longest possible reason still fits the 200-character rule", () => {
    const longest = composePauseReason("Equipment problem", "x".repeat(PAUSE_NOTE_MAX));
    expect(longest.length).toBeLessThanOrEqual(200);
  });

  it("flags an over-long note only", () => {
    expect(noteProblem("x".repeat(PAUSE_NOTE_MAX))).toBeNull();
    expect(noteProblem("x".repeat(PAUSE_NOTE_MAX + 1))).not.toBeNull();
    expect(noteProblem("")).toBeNull();
  });
});
