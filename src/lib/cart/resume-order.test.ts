import { describe, expect, it } from "vitest";
import { mayResumePendingOrder } from "./resume-order";

describe("mayResumePendingOrder", () => {
  it("only the signed-in customer who owns the order", () => {
    expect(mayResumePendingOrder("c1", "c1")).toBe(true);
  });
  it("never for a guest, a different customer, or an order with no customer", () => {
    expect(mayResumePendingOrder("c1", null)).toBe(false);
    expect(mayResumePendingOrder("c1", "c2")).toBe(false);
    expect(mayResumePendingOrder(null, "c1")).toBe(false);
    expect(mayResumePendingOrder(null, null)).toBe(false);
  });
});
