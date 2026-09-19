import { describe, expect, it } from "vitest";
import { refusedClosedText } from "./closed-copy";

describe("refusal path", () => {
  it("prints the server's label verbatim and says nothing was charged", () => {
    const text = refusedClosedText({ opensAtLabel: "tomorrow at 11:30 AM" });
    expect(text).toContain("We open tomorrow at 11:30 AM.");
    expect(text).toContain("nothing was charged");
  });
});
