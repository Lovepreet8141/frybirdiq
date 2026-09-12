import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import { changeDue, parseTender, quickTenders } from "./tender";

describe("parseTender", () => {
  it("reads whole rupees and paise", () => {
    expect(parseTender("500")).toBe(paise(50000));
    expect(parseTender("499.50")).toBe(paise(49950));
    expect(parseTender(" 20 ")).toBe(paise(2000));
  });

  it("refuses anything that is not money", () => {
    expect(parseTender("")).toBeNull();
    expect(parseTender("abc")).toBeNull();
    expect(parseTender("-5")).toBeNull();
    expect(parseTender("1.234")).toBeNull();
  });
});

describe("changeDue", () => {
  it("is the difference when enough was handed over", () => {
    expect(changeDue(paise(49900), paise(50000))).toBe(paise(100));
    expect(changeDue(paise(49900), paise(49900))).toBe(paise(0));
  });

  it("is null when the customer is short", () => {
    expect(changeDue(paise(49900), paise(40000))).toBeNull();
  });
});

describe("quickTenders", () => {
  it("offers the exact total and the next round amounts above it", () => {
    expect(quickTenders(paise(12345))).toEqual([paise(12345), paise(15000), paise(20000), paise(50000)]);
  });

  it("does not repeat an amount that several boundaries share", () => {
    expect(quickTenders(paise(49900))).toEqual([paise(49900), paise(50000)]);
  });

  it("offers nothing for an empty order", () => {
    expect(quickTenders(paise(0))).toEqual([]);
  });
});
