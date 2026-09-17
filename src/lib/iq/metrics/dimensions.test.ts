import { describe, expect, it } from "vitest";

import { type Paise, paise } from "@/lib/money";

import { FEES_DIMENSION_VALUE, NO_PRODUCT_DIMENSION_VALUE } from "./catalog";
import { feesRowAmount, productDimensionValue } from "./dimensions";

const p = (value: bigint | number): Paise => paise(value);

describe("productDimensionValue", () => {
  it("uses order_items.product_id as-is", () => {
    const id = "3f2b8c1e-0d7a-4e55-9a51-1c2d3e4f5a6b";
    expect(productDimensionValue(id)).toBe(id);
  });

  it("falls back to the no-product bucket when product_id is null", () => {
    expect(productDimensionValue(null)).toBe(NO_PRODUCT_DIMENSION_VALUE);
    expect(productDimensionValue(undefined)).toBe(NO_PRODUCT_DIMENSION_VALUE);
    expect(productDimensionValue("")).toBe(NO_PRODUCT_DIMENSION_VALUE);
    expect(productDimensionValue(null)).not.toBe(FEES_DIMENSION_VALUE);
  });
});

describe("feesRowAmount", () => {
  it("is revenue_net minus Σ line_taxable, so product rows sum to revenue_net", () => {
    const lines = [p(40_000), p(15_238), p(0)];
    const revenueNet = p(59_762); // lines 55_238 + delivery fee taxable 4_524
    const fees = feesRowAmount(revenueNet, lines);
    expect(fees).toBe(4_524n);
    expect(lines.reduce<bigint>((sum, line) => sum + line, fees)).toBe(revenueNet);
  });

  it("is zero with no fees and with no sales", () => {
    expect(feesRowAmount(p(55_238), [p(40_000), p(15_238)])).toBe(0n);
    expect(feesRowAmount(p(0), [])).toBe(0n);
  });

  it("is not clamped when order and line totals disagree", () => {
    expect(feesRowAmount(p(100), [p(150)])).toBe(-50n);
  });
});
