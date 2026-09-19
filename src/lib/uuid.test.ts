import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

// Launch audit C3: /order/abc reached `eq(orders.id, "abc")`, Postgres threw
// "invalid input syntax for type uuid" and the customer got a blank HTTP 500.
describe("isUuid", () => {
  it("accepts a real order id, any case", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
  });

  it("rejects what a mangled or truncated link carries", () => {
    for (const bad of ["abc", "", " ", "3f2504e0-4f89-41d3-9a0c-0305e82c33", "3f2504e0-4f89-41d3-9a0c-0305e82c3301x", "../etc/passwd", "1; drop table orders"]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});
