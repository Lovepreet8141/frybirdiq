import { describe, expect, it } from "vitest";
import { add, bps, formatINR, fromRupees } from "@/lib/money";
import { gst, splitTax, sumGst } from "./gst";

describe("splitTax", () => {
  it("halves an intra-state tax into CGST and SGST", () => {
    const { cgst, sgst, igst } = splitTax(fromRupees("12.50"), "intra-state");
    expect(cgst).toBe(625n);
    expect(sgst).toBe(625n);
    expect(igst).toBe(0n);
  });

  it("keeps an odd paise from vanishing", () => {
    // ₹0.05 cannot halve evenly. Rounding each side to 0.03 would invent a
    // paise; rounding both down to 0.02 would lose one.
    const { cgst, sgst } = splitTax(fromRupees("0.05"), "intra-state");
    expect(add(cgst, sgst)).toBe(fromRupees("0.05"));
    expect(cgst).toBe(3n);
    expect(sgst).toBe(2n);
  });

  it("puts the whole tax in IGST for an inter-state supply", () => {
    const { cgst, sgst, igst } = splitTax(fromRupees("12.50"), "inter-state");
    expect(cgst).toBe(0n);
    expect(sgst).toBe(0n);
    expect(igst).toBe(1_250n);
  });
});

describe("gst on an exclusive price", () => {
  it("adds tax on top", () => {
    // A ₹249 order, restaurant service at 5%.
    const line = gst(fromRupees("249"), bps(5));
    expect(line.taxable).toBe(fromRupees("249"));
    expect(line.total).toBe(fromRupees("12.45"));
    expect(line.cgst).toBe(fromRupees("6.23"));
    expect(line.sgst).toBe(fromRupees("6.22"));
    expect(line.gross).toBe(fromRupees("261.45"));
  });

  it("keeps the components summing to the total", () => {
    const line = gst(fromRupees("249"), bps(5));
    expect(add(line.cgst, line.sgst, line.igst)).toBe(line.total);
    expect(add(line.taxable, line.total)).toBe(line.gross);
  });
});

describe("gst on an inclusive price", () => {
  it("extracts tax from within the price", () => {
    // ₹100 inclusive of 5% is not ₹95 + ₹5.
    const line = gst(fromRupees("100"), bps(5), { basis: "inclusive" });
    expect(line.gross).toBe(fromRupees("100"));
    expect(line.taxable).toBe(fromRupees("95.23"));
    expect(line.total).toBe(fromRupees("4.77"));
    expect(add(line.taxable, line.total)).toBe(fromRupees("100"));
  });

  it("never leaves the customer paying a different number than the listed price", () => {
    // Any listed price must survive the round trip exactly, or the aggregator
    // menu and the receipt disagree.
    for (const listed of ["99", "149", "199.99", "249.50", "1", "0.01"]) {
      const line = gst(fromRupees(listed), bps(5), { basis: "inclusive" });
      expect(line.gross).toBe(fromRupees(listed));
      expect(add(line.taxable, line.total)).toBe(fromRupees(listed));
    }
  });

  it("differs from exclusive, which is the whole point of the flag", () => {
    const exclusive = gst(fromRupees("100"), bps(5), { basis: "exclusive" });
    const inclusive = gst(fromRupees("100"), bps(5), { basis: "inclusive" });
    expect(formatINR(exclusive.gross)).toBe("₹105");
    expect(formatINR(inclusive.gross)).toBe("₹100");
    expect(exclusive.taxable).not.toBe(inclusive.taxable);
  });
});

describe("sumGst", () => {
  it("taxes each line at its own rate instead of blending them", () => {
    // A burger taxed as restaurant service at 5%, a bottled drink at 12%.
    const burger = gst(fromRupees("199"), bps(5));
    const drink = gst(fromRupees("60"), bps(12));
    const order = sumGst([burger, drink]);

    expect(order.taxable).toBe(fromRupees("259"));
    expect(order.total).toBe(fromRupees("17.15")); // 9.95 + 7.20
    expect(order.gross).toBe(fromRupees("276.15"));
    expect(add(order.cgst, order.sgst, order.igst)).toBe(order.total);
  });

  it("returns a zero breakdown for an empty order", () => {
    const empty = sumGst([]);
    expect(empty.gross).toBe(0n);
    expect(empty.total).toBe(0n);
  });
});
