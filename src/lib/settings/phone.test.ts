import { describe, expect, it } from "vitest";
import { parseContactPhone, readStoredPhone } from "./phone";

describe("parseContactPhone", () => {
  it.each(["9876543210", "+91 98765 43210", "0171-2345678", "(0171) 234 5678", "0172 255 0123", "9198765432", "  98765   43210  "])("accepts %s", (raw) => {
    expect(parseContactPhone(raw).ok).toBe(true);
  });

  it("trims and collapses whitespace but does not reformat", () => {
    expect(parseContactPhone("  +91   98765 43210 ")).toEqual({ ok: true, value: "+91 98765 43210", href: "tel:+919876543210" });
  });

  it.each([
    "",
    "   ",
    "call us",
    "98765abc10",
    "-------",
    "()()()()",
    "+++++++++",
    "98765+43210",
    "123456",
    "1234567",
    "12345678",
    "123456789",
    "1234567890123456",
    "+44 20 7946 0958",
    "+1 415 555 0132",
    "+9876543210",
    "0987654321",
    "0 0172 255 0123",
    "1800 123 45",
    "+1800 123 4567",
    "1860 500 1234",
    "1800 123 456",
    "1234567890",
    "+91 1860 500 1234",
    "91 1860 500 1234",
    "91 1860 500 123",
    "91 1900 123 456",
    "0 1860 500 1234",
    "01860 500 1234",
    "01860 500 123",
  ])("rejects %j", (raw) => {
    expect(parseContactPhone(raw).ok).toBe(false);
  });

  it("gives a clear field error for numbers that cannot be dialled", () => {
    const r = parseContactPhone("12345678");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("10-digit Indian number") });
  });

  it.each([
    ["9876543210", "tel:+919876543210"],
    ["0172 255 0123", "tel:+911722550123"],
    ["0171-2345678", "tel:+911712345678"],
    ["09876543210", "tel:+919876543210"],
    ["919876543210", "tel:+919876543210"],
    ["+91 98765 43210", "tel:+919876543210"],
    ["1800 123 4567", "tel:18001234567"],
  ])("%s dials %s", (raw, href) => {
    expect(parseContactPhone(raw)).toEqual({ ok: true, value: raw.replace(/\s+/g, " "), href });
  });
});

describe("readStoredPhone", () => {
  it("returns the number when set", () => {
    expect(readStoredPhone("+91 98765 43210")).toBe("+91 98765 43210");
  });

  it("reads a legacy stored value that fails the rule as null", () => {
    // e.g. an 8-digit number saved under the old 7-15 digit rule
    expect(readStoredPhone("2550123")).toBeNull();
    expect(readStoredPhone("25501234")).toBeNull();
    expect(readStoredPhone("+44 20 7946 0958")).toBeNull();
  });

  it.each([null, undefined, "", "   ", "-", "n/a"])("returns null (never an empty string) for %j", (stored) => {
    expect(readStoredPhone(stored)).toBeNull();
  });
});
