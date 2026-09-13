import { describe, expect, it } from "vitest";
import { counterPhoneSchema, parseMobile, rewardsSummary } from "./rewards-enrolment";

describe("parseMobile", () => {
  it("accepts a plain 10-digit Indian mobile", () => {
    expect(parseMobile("9355533343")).toEqual({ ok: true, phone: "9355533343" });
  });

  it("forgives how the number was written", () => {
    expect(parseMobile("+91 93555 33343")).toEqual({ ok: true, phone: "9355533343" });
    expect(parseMobile("919355533343")).toEqual({ ok: true, phone: "9355533343" });
    expect(parseMobile("09355533343")).toEqual({ ok: true, phone: "9355533343" });
    expect(parseMobile("93555-33343")).toEqual({ ok: true, phone: "9355533343" });
  });

  it("refuses an invalid number with one inline sentence and never a phone", () => {
    for (const raw of ["", "12345", "93555333431", "5355533343", "93555abc43"]) {
      const result = parseMobile(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe("counterPhoneSchema — the server's copy of the same rule", () => {
  it("passes only what the keypad would have passed", () => {
    expect(counterPhoneSchema.safeParse("9355533343").success).toBe(true);
    expect(counterPhoneSchema.safeParse("+919355533343").success).toBe(false);
    expect(counterPhoneSchema.safeParse("12345").success).toBe(false);
    expect(counterPhoneSchema.safeParse("5355533343").success).toBe(false);
  });

  it("is what placeCounterOrderAction validates, so an invalid phone means no order is placed", () => {
    // Mirrors counterOrderSchema in src/lib/pos/actions.ts: a nullable phone
    // that, when present, must satisfy this schema — a bad number fails the
    // parse before any repository call, and a missing one is simply null.
    const schema = counterPhoneSchema.nullable().default(null);
    expect(schema.safeParse(undefined)).toEqual({ success: true, data: null });
    expect(schema.safeParse(null)).toEqual({ success: true, data: null });
    expect(schema.safeParse("9355533343").success).toBe(true);
    expect(schema.safeParse("abc").success).toBe(false);
  });
});

describe("rewardsSummary", () => {
  it("says a new customer is enrolled with this order", () => {
    expect(rewardsSummary({ found: false, rewards: null, points: null })).toBe("New — enrolled with this order");
  });

  it("shows stamps and points for a known customer", () => {
    expect(rewardsSummary({ found: true, rewards: { stampCount: 3, stampsRequired: 5, availableRewardCount: 0 }, points: 120 })).toBe("3/5 stamps · 120 points");
    expect(rewardsSummary({ found: true, rewards: { stampCount: 0, stampsRequired: 5, availableRewardCount: 1 }, points: 1 })).toBe("1 reward ready · 1 point");
  });

  it("says so when the programs are off or untouched", () => {
    expect(rewardsSummary({ found: true, rewards: null, points: null })).toBe("No rewards activity yet");
  });
});
