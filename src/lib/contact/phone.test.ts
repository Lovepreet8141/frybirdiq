import { describe, expect, it } from "vitest";
import { shopPhone } from "./phone";

describe("shopPhone", () => {
  it("builds a tel: link from a stored number in any common format", () => {
    expect(shopPhone("98765 43210")).toEqual({ display: "98765 43210", href: "tel:+919876543210" });
    expect(shopPhone("+91 98765-43210")?.href).toBe("tel:+919876543210");
    expect(shopPhone("09876543210")?.href).toBe("tel:+919876543210");
  });

  it("returns null when absent, blank or too short, so no call line renders", () => {
    expect(shopPhone(null)).toBeNull();
    expect(shopPhone(undefined)).toBeNull();
    expect(shopPhone("")).toBeNull();
    expect(shopPhone("   ")).toBeNull();
    expect(shopPhone("12345")).toBeNull();
  });
});
