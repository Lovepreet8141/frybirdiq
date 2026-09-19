import { describe, expect, it } from "vitest";
import { parseContactPhone, readStoredPhone } from "@/lib/settings/phone";
import { shopPhone } from "./phone";

describe("shopPhone", () => {
  it("builds a tel: link from a stored number in any common format", () => {
    expect(shopPhone("98765 43210")).toEqual({ display: "98765 43210", href: "tel:+919876543210" });
    expect(shopPhone("+91 98765-43210")?.href).toBe("tel:+919876543210");
    expect(shopPhone("09876543210")?.href).toBe("tel:+919876543210");
    expect(shopPhone("919876543210")?.href).toBe("tel:+919876543210");
    expect(shopPhone("0172 255 0123")?.href).toBe("tel:+911722550123");
  });

  it("dials a 1800 toll-free number as-is, never truncated", () => {
    expect(shopPhone("1800 123 4567")).toEqual({ display: "1800 123 4567", href: "tel:18001234567" });
  });

  it("returns null when absent, blank, too short or not dialable from India, so no call line renders", () => {
    for (const raw of [null, undefined, "", "   ", "12345", "2550123", "25501234", "255012345", "+44 20 7946 0958", "call us"]) {
      expect(shopPhone(raw)).toBeNull();
    }
  });
});

describe("write and read agree", () => {
  const inputs = [
    "9876543210",
    "98765 43210",
    "+91 98765 43210",
    "+919876543210",
    "919876543210",
    "09876543210",
    "0172 255 0123",
    "(0171) 234 5678",
    "1800 123 4567",
    "1800-123-4567",
    "1860 500 1234",
    "1800 123 456",
    "1234567890",
    "9198765432",
    "+91 1860 500 1234",
    "91 1860 500 1234",
    "0 1860 500 1234",
    "01860 500 1234",
    "2550123",
    "25501234",
    "255012345",
    "+44 20 7946 0958",
    "12345678901234",
    "abc",
    "",
  ];

  it.each(inputs)("%j: accepted on write iff shown and dialable on read, with the same href", (raw) => {
    const written = parseContactPhone(raw);
    const read = shopPhone(readStoredPhone(written.ok ? written.value : raw));
    if (written.ok) {
      expect(read).toEqual({ display: written.value, href: written.href });
    } else {
      expect(read).toBeNull();
    }
  });

  it("everything the write side accepts yields non-null on the read side", () => {
    const accepted = inputs.map(parseContactPhone).filter((r) => r.ok);
    expect(accepted.length).toBeGreaterThan(8);
    for (const r of accepted) expect(shopPhone(r.value)).not.toBeNull();
  });
});
