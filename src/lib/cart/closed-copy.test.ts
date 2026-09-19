import { describe, expect, it } from "vitest";
import { refusedClosedText } from "./closed-copy";

describe("refusal path", () => {
  it("prints the server's label verbatim and says nothing was charged", () => {
    const text = refusedClosedText({ opensAtLabel: "tomorrow at 11:30 AM" });
    expect(text).toContain("We open tomorrow at 11:30 AM.");
    expect(text).toContain("nothing was charged");
  });
});


describe("refusedClosedText on a whole closed day", () => {
  it("says closed today, promises no 'choose a time', and carries the owner's note", () => {
    expect(refusedClosedText({ opensAtLabel: "Wednesday at 11:30 AM", dayOff: { source: "DATE", note: "Closed for Diwali" } })).toBe(
      "We're closed today, so this order wasn't placed and nothing was charged. We open again Wednesday at 11:30 AM. Closed for Diwali",
    );
    expect(refusedClosedText({ opensAtLabel: "tomorrow at 11:30 AM", dayOff: { source: "WEEKLY", weekday: 2, note: null } })).toBe(
      "We're closed today, so this order wasn't placed and nothing was charged. We open again tomorrow at 11:30 AM.",
    );
  });

  it("closed by the clock keeps the old words, including 'Choose a time to order ahead.'", () => {
    expect(refusedClosedText({ opensAtLabel: "tomorrow at 11:30 AM", dayOff: null })).toContain("Choose a time to order ahead.");
  });
});
