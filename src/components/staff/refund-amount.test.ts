import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import { readAmount } from "./refund-amount";

describe("readAmount", () => {
  const remaining = paise(50_000); // ₹500.00

  it("defaults to everything left when blank", () => {
    expect(readAmount("", remaining)).toEqual({ value: remaining, error: null });
  });

  it("defaults to everything left when only whitespace", () => {
    expect(readAmount("   ", remaining)).toEqual({ value: remaining, error: null });
  });

  it("accepts an amount under the cap", () => {
    expect(readAmount("100", remaining)).toEqual({ value: paise(10_000), error: null });
  });

  it("accepts an amount exactly at the cap", () => {
    expect(readAmount("500", remaining)).toEqual({ value: remaining, error: null });
  });

  it("refuses an amount over the cap — the RESERVED+SUCCEEDED-aware limit", () => {
    expect(readAmount("500.01", remaining)).toEqual({ value: remaining, error: "Can't refund more than ₹500." });
  });

  it("refuses zero", () => {
    expect(readAmount("0", remaining)).toEqual({ value: remaining, error: "Enter an amount greater than zero." });
  });

  it("refuses a negative amount", () => {
    expect(readAmount("-50", remaining)).toEqual({ value: remaining, error: "Enter an amount greater than zero." });
  });

  it("refuses text that isn't an amount", () => {
    expect(readAmount("abc", remaining)).toEqual({ value: remaining, error: "Enter a valid amount." });
  });
});
