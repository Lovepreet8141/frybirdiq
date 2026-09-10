import { describe, expect, it } from "vitest";
import {
  ZERO,
  abs,
  add,
  allocate,
  bps,
  compare,
  formatAmount,
  formatBps,
  formatINR,
  fromRupees,
  isNegative,
  isZero,
  multiply,
  negate,
  paise,
  percentOf,
  ratioBps,
  scale,
  subtract,
  toRupeesFloat,
} from "./index";

describe("fromRupees", () => {
  it("reads plain and decimal strings", () => {
    expect(fromRupees("2800")).toBe(280_000n);
    expect(fromRupees("2800.50")).toBe(280_050n);
    expect(fromRupees("0.01")).toBe(1n);
    expect(fromRupees(".5")).toBe(50n);
  });

  it("reads amounts as a human writes them, with symbol and Indian grouping", () => {
    expect(fromRupees("₹1,04,999.99")).toBe(10_499_999n);
    expect(fromRupees("  9,40,000 ")).toBe(94_000_000n);
  });

  it("reads negatives", () => {
    expect(fromRupees("-250.75")).toBe(-25_075n);
  });

  it("rounds float input to the nearest paise instead of trusting IEEE 754", () => {
    // 33.33 * 100 is 3332.9999999999995 in binary floating point.
    expect(fromRupees(33.33)).toBe(3_333n);
    expect(fromRupees(2800.5)).toBe(280_050n);
  });

  it("refuses amounts finer than a paise", () => {
    expect(() => fromRupees("10.005")).toThrow(/finer than one paise/);
  });

  it("refuses junk", () => {
    expect(() => fromRupees("chicken")).toThrow(/cannot read/);
    expect(() => fromRupees("")).toThrow(/cannot read/);
    expect(() => fromRupees(Number.NaN)).toThrow(/not a finite amount/);
  });
});

describe("paise", () => {
  it("refuses a fractional paise", () => {
    expect(() => paise(10.5)).toThrow(/not a whole number of paise/);
  });
});

describe("arithmetic", () => {
  it("adds, subtracts and negates", () => {
    expect(add(fromRupees("100"), fromRupees("250.50"))).toBe(35_050n);
    expect(add()).toBe(ZERO);
    expect(subtract(fromRupees("100"), fromRupees("250"))).toBe(-15_000n);
    expect(negate(fromRupees("100"))).toBe(-10_000n);
    expect(abs(fromRupees("-100"))).toBe(10_000n);
  });

  it("multiplies by a whole quantity", () => {
    expect(multiply(fromRupees("149"), 3)).toBe(44_700n);
  });

  it("refuses a fractional quantity, which is what scale is for", () => {
    expect(() => multiply(fromRupees("149"), 1.5)).toThrow(/whole quantity/);
  });

  it("scales a pack price down to a recipe quantity", () => {
    // A 1 kg pack of chicken at ₹280; a burger uses 150 g.
    expect(scale(fromRupees("280"), 150, 1000)).toBe(4_200n);
  });

  it("rounds a scale result half away from zero", () => {
    // ₹1.00 split three ways is 33.333 paise per part.
    expect(scale(fromRupees("1"), 1, 3)).toBe(33n);
    expect(scale(fromRupees("1"), 2, 3)).toBe(67n);
    expect(scale(fromRupees("-1"), 2, 3)).toBe(-67n);
  });

  it("compares and tests", () => {
    expect(compare(fromRupees("1"), fromRupees("2"))).toBe(-1);
    expect(compare(fromRupees("2"), fromRupees("2"))).toBe(0);
    expect(compare(fromRupees("3"), fromRupees("2"))).toBe(1);
    expect(isZero(ZERO)).toBe(true);
    expect(isNegative(fromRupees("-1"))).toBe(true);
  });
});

describe("percentages", () => {
  it("converts human percentages to basis points", () => {
    expect(bps(5)).toBe(500);
    expect(bps(2.5)).toBe(250);
    expect(bps(0.01)).toBe(1);
  });

  it("refuses a percentage finer than a basis point", () => {
    expect(() => bps(0.001)).toThrow(/finer than one basis point/);
  });

  it("applies a rate", () => {
    // GST at 5% on a ₹249 order.
    expect(percentOf(fromRupees("249"), bps(5))).toBe(1_245n);
    // A rate with a fractional percentage, to prove basis points hold it.
    expect(percentOf(fromRupees("400"), bps(22.5))).toBe(9_000n);
  });

  it("expresses a ratio in basis points", () => {
    // Food cost of ₹82.50 on net sales of ₹300 is 27.5%.
    expect(ratioBps(fromRupees("82.50"), fromRupees("300"))).toBe(2_750);
  });

  it("returns a zero ratio on a day with no sales rather than throwing", () => {
    expect(ratioBps(fromRupees("500"), ZERO)).toBe(0);
  });
});

describe("allocate", () => {
  it("splits so the parts sum to exactly the total", () => {
    const parts = allocate(fromRupees("100"), [1, 1, 1]);
    expect(parts).toEqual([3_334n, 3_333n, 3_333n]);
    expect(add(...parts)).toBe(fromRupees("100"));
  });

  it("weights a discount across order lines of different value", () => {
    // ₹50 off an order of ₹149 + ₹249 + ₹99.
    const total = fromRupees("50");
    const parts = allocate(total, [14_900, 24_900, 9_900]);
    expect(add(...parts)).toBe(total);
    expect(parts[1]).toBeGreaterThan(parts[0]);
    expect(parts[0]).toBeGreaterThan(parts[2]);
  });

  it("keeps a negative total exact too", () => {
    const parts = allocate(fromRupees("-100"), [1, 1, 1]);
    expect(add(...parts)).toBe(fromRupees("-100"));
  });

  it("refuses degenerate weights", () => {
    expect(() => allocate(fromRupees("10"), [])).toThrow(/at least one weight/);
    expect(() => allocate(fromRupees("10"), [0, 0])).toThrow(/cannot all be zero/);
    expect(() => allocate(fromRupees("10"), [-1, 2])).toThrow(/cannot be negative/);
  });
});

describe("formatINR", () => {
  it("groups the Indian way, not the Western way", () => {
    // The whole reason this module exists: 9,40,000 and not 940,000.
    expect(formatINR(fromRupees("940000"))).toBe("₹9,40,000");
    expect(formatINR(fromRupees("100000"))).toBe("₹1,00,000");
    expect(formatINR(fromRupees("1000"))).toBe("₹1,000");
    expect(formatINR(fromRupees("11000000"))).toBe("₹1,10,00,000");
  });

  it("shows paise only when the amount has them", () => {
    expect(formatINR(fromRupees("249"))).toBe("₹249");
    expect(formatINR(fromRupees("33.50"))).toBe("₹33.50");
  });

  it("always shows paise for a unit cost", () => {
    expect(formatINR(fromRupees("33"), "unit")).toBe("₹33.00");
  });

  it("rounds to whole rupees at business scale", () => {
    expect(formatINR(fromRupees("2840.62"), "whole")).toBe("₹2,841");
    expect(formatINR(fromRupees("2840.12"), "whole")).toBe("₹2,840");
  });

  it("renders negatives", () => {
    expect(formatINR(fromRupees("-1500"))).toBe("-₹1,500");
  });

  it("renders zero", () => {
    expect(formatINR(ZERO)).toBe("₹0");
  });

  it("stays exact past the float safe-integer range", () => {
    // ₹1,00,00,00,00,00,000 — absurd for one outlet, but the type allows it
    // and a silent precision loss here would be invisible.
    const huge = paise(10n ** 17n);
    expect(formatAmount(huge, "whole")).toBe("1,00,00,00,00,00,00,000");
  });

  it("drops the symbol when the table header carries the unit", () => {
    expect(formatAmount(fromRupees("940000"))).toBe("9,40,000");
  });
});

describe("formatBps", () => {
  it("renders a food cost percentage", () => {
    expect(formatBps(2_750)).toBe("27.5%");
    expect(formatBps(2_250, 0)).toBe("23%");
  });
});

describe("toRupeesFloat", () => {
  it("converts for charting", () => {
    expect(toRupeesFloat(fromRupees("2840.50"))).toBe(2840.5);
  });
});
