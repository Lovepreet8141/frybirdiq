import { describe, expect, it } from "vitest";
import { STALE_PRICE_DAYS, daysSince, inventoryAttention, type AttentionInput } from "./attention";

const now = new Date("2026-09-14T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

function row(overrides: Partial<AttentionInput> & { id: string }): AttentionInput {
  return { name: overrides.id, isActive: true, costPerBaseUnit: 100n, lastPricedAt: daysAgo(1), supplierName: "Fresh Farms", ...overrides };
}

describe("daysSince", () => {
  it("floors to whole days and never goes negative", () => {
    expect(daysSince(daysAgo(3), now)).toBe(3);
    expect(daysSince(new Date(now.getTime() - 86_399_000), now)).toBe(0);
    expect(daysSince(new Date(now.getTime() + 86_400_000), now)).toBe(0);
  });
});

describe("inventoryAttention", () => {
  it("returns nothing when every active ingredient is priced, fresh and sourced", () => {
    expect(inventoryAttention([row({ id: "chicken" }), row({ id: "flour" })], now)).toEqual([]);
  });

  it("flags an unpriced ingredient before anything else", () => {
    const items = inventoryAttention([row({ id: "old", lastPricedAt: daysAgo(90) }), row({ id: "new", costPerBaseUnit: 0n, lastPricedAt: null })], now);
    expect(items.map((item) => `${item.kind}:${item.ingredientId}`)).toEqual(["unpriced:new", "stale-price:old"]);
  });

  it("treats a price exactly at the threshold as stale, one day inside it as fresh", () => {
    const items = inventoryAttention([row({ id: "edge", lastPricedAt: daysAgo(STALE_PRICE_DAYS) }), row({ id: "fresh", lastPricedAt: daysAgo(STALE_PRICE_DAYS - 1) })], now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "stale-price", ingredientId: "edge", detail: `Last priced ${STALE_PRICE_DAYS} days ago` });
  });

  it("orders stale prices oldest first", () => {
    const items = inventoryAttention([row({ id: "a", lastPricedAt: daysAgo(40) }), row({ id: "b", lastPricedAt: daysAgo(75) })], now);
    expect(items.map((item) => item.ingredientId)).toEqual(["b", "a"]);
  });

  it("flags a missing supplier, and can flag one ingredient twice", () => {
    const items = inventoryAttention([row({ id: "salt", costPerBaseUnit: 0n, lastPricedAt: null, supplierName: null })], now);
    expect(items.map((item) => item.kind)).toEqual(["unpriced", "no-supplier"]);
  });

  it("ignores inactive ingredients entirely", () => {
    const items = inventoryAttention([row({ id: "gone", isActive: false, costPerBaseUnit: 0n, lastPricedAt: null, supplierName: null })], now);
    expect(items).toEqual([]);
  });
});
