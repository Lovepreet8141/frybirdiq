import { describe, expect, it } from "vitest";
import { parseContactPhone, readStoredPhone } from "./phone";

describe("parseContactPhone", () => {
  it.each(["9876543210", "+91 98765 43210", "0171-2345678", "(0171) 234 5678", "  98765   43210  "])("accepts %s", (raw) => {
    expect(parseContactPhone(raw).ok).toBe(true);
  });

  it("trims and collapses whitespace but does not reformat", () => {
    expect(parseContactPhone("  +91   98765 43210 ")).toEqual({ ok: true, value: "+91 98765 43210" });
  });

  it.each(["", "   ", "call us", "98765abc10", "-------", "()()()()", "+++++++++", "98765+43210", "123456", "1234567890123456"])(
    "rejects %j",
    (raw) => {
      expect(parseContactPhone(raw).ok).toBe(false);
    },
  );
});

describe("readStoredPhone", () => {
  it("returns the number when set", () => {
    expect(readStoredPhone("+91 98765 43210")).toBe("+91 98765 43210");
  });

  it.each([null, undefined, "", "   ", "-", "n/a"])("returns null (never an empty string) for %j", (stored) => {
    expect(readStoredPhone(stored)).toBeNull();
  });
});
