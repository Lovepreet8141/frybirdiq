import { describe, expect, it } from "vitest";
import { fromRupees, paise } from "@/lib/money";
import { expectedCash, parseCashAmount, sumPaise, varianceOf, varianceWords } from "./session";

describe("expectedCash", () => {
  it("float + cash taken - cash refunded, in integer paise", () => {
    expect(expectedCash({ openingFloat: fromRupees("2000"), cashTaken: fromRupees("8450.50"), cashRefunded: fromRupees("199") })).toBe(fromRupees("10251.50"));
  });
  it("a quiet session is just its float", () => {
    expect(expectedCash({ openingFloat: fromRupees("2000"), cashTaken: paise(0), cashRefunded: paise(0) })).toBe(fromRupees("2000"));
  });
  it("never rounds: one paisa in, one paisa out", () => {
    expect(expectedCash({ openingFloat: paise(1), cashTaken: paise(1), cashRefunded: paise(1) })).toBe(paise(1));
  });
});

describe("variance", () => {
  it("counted - expected, and said in words", () => {
    expect(varianceOf(fromRupees("9980"), fromRupees("10000"))).toBe(fromRupees("-20"));
    expect(varianceWords(fromRupees("-20"))).toBe("₹20 short");
    expect(varianceWords(fromRupees("15.50"))).toBe("₹15.50 over");
    expect(varianceWords(paise(0))).toBe("Exact");
  });
});

describe("parseCashAmount", () => {
  it("digits with up to two decimals, zero allowed", () => {
    expect(parseCashAmount("2000", "the float")).toEqual({ ok: true, value: fromRupees("2000") });
    expect(parseCashAmount(" 2000.5 ", "the float")).toEqual({ ok: true, value: fromRupees("2000.50") });
    expect(parseCashAmount("0", "the float")).toEqual({ ok: true, value: paise(0) });
  });
  it.each(["", "-5", "abc", "1e3", "2,000", "12.345", "₹200", "10000000.01", "99999999999"])("refuses %j", (text) => {
    expect(parseCashAmount(text, "the amount").ok).toBe(false);
  });
});

describe("sumPaise", () => {
  it("adds bigints exactly and an empty list is zero", () => {
    expect(sumPaise([])).toBe(paise(0));
    expect(sumPaise([paise(9_007_199_254_740_993n), paise(1n)])).toBe(paise(9_007_199_254_740_994n));
  });
});
