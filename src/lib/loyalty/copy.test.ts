import { describe, expect, it } from "vitest";
import { LOYALTY_DISABLED, type LoyaltyConfig } from "./index";
import { earnPreview, pointsRule, stampProgress, stampRule, stampRuleShort } from "./copy";
import { STAMP_DISABLED, type StampConfig } from "./stamps";
import { fromRupees, paise } from "@/lib/money";

const stamps = (over: Partial<StampConfig> = {}): StampConfig => ({ enabled: true, stampsRequired: 8, minOrderValue: fromRupees("200"), maxRewardValue: fromRupees("150"), ...over });
const loyalty = (over: Partial<LoyaltyConfig> = {}): LoyaltyConfig => ({ earnBps: 500, pointValue: paise(100), minRedeemPoints: 0, ...over });

describe("rules come from the config", () => {
  it("stamp rule reflects every figure, so changing the config changes the text", () => {
    expect(stampRule(stamps())).toContain("over ₹200");
    expect(stampRule(stamps())).toContain("Collect 8");
    expect(stampRule(stamps())).toContain("up to ₹150");
    const changed = stampRule(stamps({ stampsRequired: 5, minOrderValue: fromRupees("300"), maxRewardValue: fromRupees("99") }))!;
    expect(changed).toContain("over ₹300");
    expect(changed).toContain("Collect 5");
    expect(changed).toContain("up to ₹99");
    expect(changed).not.toContain("₹200");
    expect(stampRuleShort(stamps({ stampsRequired: 6 }))).toContain("6 stamps");
  });

  it("says nothing when a programme is off", () => {
    expect(stampRule(STAMP_DISABLED)).toBeNull();
    expect(stampRule(stamps({ enabled: false }))).toBeNull();
    expect(stampRuleShort(STAMP_DISABLED)).toBeNull();
    expect(pointsRule(LOYALTY_DISABLED)).toBeNull();
    expect(stampProgress(3, 0, STAMP_DISABLED)).toBeNull();
  });

  it("points rule follows the earn rate and minimum", () => {
    expect(pointsRule(loyalty())).toBe("5% back as points on every order.");
    expect(pointsRule(loyalty({ earnBps: 1000, minRedeemPoints: 50 }))).toBe("10% back as points on every order, spendable once you have 50.");
  });
});

describe("stampProgress maths", () => {
  it("at 0", () => {
    const p = stampProgress(0, 0, stamps())!;
    expect(p).toMatchObject({ ready: false, count: 0, required: 8, remaining: 8, label: "0 of 8" });
    expect(p.text).toContain("8 more orders");
  });

  it("at 7 of 8: one order to go, singular", () => {
    const p = stampProgress(7, 0, stamps())!;
    expect(p).toMatchObject({ ready: false, remaining: 1, label: "7 of 8" });
    expect(p.text).toBe("7 of 8 — 1 more order over ₹200 to a free item (up to ₹150).");
  });

  it("at 8 of 8: the reward is ready, nothing remaining", () => {
    const p = stampProgress(8, 1, stamps())!;
    expect(p).toMatchObject({ ready: true, remaining: 0, label: "8 of 8" });
    expect(p.text).toContain("ready");
  });

  it("after a reward: the free item waits and the count restarts from what is left over", () => {
    const waiting = stampProgress(2, 1, stamps())!;
    expect(waiting).toMatchObject({ ready: true, label: "2 of 8" });
    const redeemed = stampProgress(2, 0, stamps())!;
    expect(redeemed).toMatchObject({ ready: false, remaining: 6, label: "2 of 8" });
  });

  it("follows a changed card size", () => {
    expect(stampProgress(3, 0, stamps({ stampsRequired: 5 }))!.text).toContain("3 of 5 — 2 more orders");
  });

  it("never shows more than a full card, or a negative count", () => {
    expect(stampProgress(11, 0, stamps())!.label).toBe("8 of 8");
    expect(stampProgress(-2, 0, stamps())!.label).toBe("0 of 8");
  });
});

describe("earnPreview", () => {
  it("signed in: names what this order earns", () => {
    expect(earnPreview({ spend: fromRupees("400"), signedIn: true, loyalty: loyalty(), stamps: stamps() })).toEqual(["This order earns a stamp and 20 points, added when it's paid."]);
  });

  it("stamp threshold is strictly greater than", () => {
    const exactly = earnPreview({ spend: fromRupees("200"), signedIn: true, loyalty: LOYALTY_DISABLED, stamps: stamps() });
    expect(exactly).toEqual(["Spend over ₹200 to earn a stamp."]);
    expect(earnPreview({ spend: paise(20001), signedIn: true, loyalty: LOYALTY_DISABLED, stamps: stamps() })[0]).toContain("a stamp");
  });

  it("guests are told to sign in, and the figures still come from config", () => {
    expect(earnPreview({ spend: fromRupees("400"), signedIn: false, loyalty: loyalty({ earnBps: 1000 }), stamps: stamps() })[0]).toBe("Sign in to earn a stamp and 40 points on this order.");
  });

  it("is empty when both programmes are off", () => {
    expect(earnPreview({ spend: fromRupees("400"), signedIn: true, loyalty: LOYALTY_DISABLED, stamps: STAMP_DISABLED })).toEqual([]);
  });
});
