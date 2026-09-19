import { describe, expect, it } from "vitest";
import { LOYALTY_DISABLED, pointsEarned, type LoyaltyConfig } from "./index";
import { earnPreview, pointsRule, stampProgress, stampRule, stampRuleShort } from "./copy";
import { qualifiesForStamp, STAMP_DISABLED, type StampConfig } from "./stamps";
import { fromRupees, paise, type Paise } from "@/lib/money";

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
    expect(pointsRule(loyalty())).toBe("Signed in, 5% of what you pay for food (after offers and points) comes back as points on paid orders.");
    expect(pointsRule(loyalty({ earnBps: 1000, minRedeemPoints: 50 }))).toBe("Signed in, 10% of what you pay for food (after offers and points) comes back as points on paid orders, spendable once you have 50.");
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
  const preview = (spend: Paise, over: { signedIn?: boolean; loyalty?: LoyaltyConfig; stamps?: StampConfig } = {}) =>
    earnPreview({ spend, signedIn: over.signedIn ?? true, loyalty: over.loyalty ?? loyalty(), stamps: over.stamps ?? stamps() });

  it("signed in: the owner's wording, one line per thing earned", () => {
    expect(preview(fromRupees("400"))).toEqual(["You'll earn 1 stamp when this order is completed.", "You'll earn 20 points when this order is completed."]);
  });

  it("says nothing for a part that earns nothing — never '0 stamps' or '0 points'", () => {
    expect(preview(fromRupees("100"))).toEqual(["You'll earn 5 points when this order is completed."]);
    expect(preview(fromRupees("400"), { loyalty: LOYALTY_DISABLED })).toEqual(["You'll earn 1 stamp when this order is completed."]);
    expect(preview(paise(0))).toEqual([]);
    expect(preview(fromRupees("400"), { loyalty: LOYALTY_DISABLED, stamps: STAMP_DISABLED })).toEqual([]);
    for (const line of preview(fromRupees("100"))) expect(line).not.toMatch(/\b0 (stamps?|points?)/);
  });

  it("uses singular for one point", () => {
    expect(preview(paise(2000), { loyalty: loyalty({ earnBps: 500, pointValue: paise(100) }) })).toEqual(["You'll earn 1 point when this order is completed."]);
  });

  it("agrees with the ledger's own functions at the threshold (200.00 vs 200.01)", () => {
    for (const spend of [paise(20000), paise(20001), paise(19999), fromRupees("1000")]) {
      const shows = preview(spend).some((line) => line.includes("1 stamp"));
      expect(shows).toBe(qualifiesForStamp(spend, stamps()));
      const pts = pointsEarned(spend, loyalty());
      expect(preview(spend).some((line) => line.includes("point"))).toBe(pts > 0);
      if (pts > 0) expect(preview(spend).join(" ")).toContain(`${pts} point`);
    }
    expect(preview(paise(20000)).some((line) => line.includes("stamp"))).toBe(false);
    expect(preview(paise(20001)).some((line) => line.includes("stamp"))).toBe(true);
  });

  it("guests are told to sign in, with the same parts and the same figures", () => {
    expect(preview(fromRupees("400"), { signedIn: false, loyalty: loyalty({ earnBps: 1000 }) })).toEqual(["Sign in to earn 1 stamp and 40 points on this order."]);
    expect(preview(fromRupees("100"), { signedIn: false })).toEqual(["Sign in to earn 5 points on this order."]);
    expect(preview(paise(0), { signedIn: false })).toEqual([]);
  });
});

describe("rule text says who and what earns", () => {
  it("names signed in, paid orders and food after offers, and no longer says 'every order'", () => {
    for (const text of [stampRule(stamps())!, stampRuleShort(stamps())!, pointsRule(loyalty())!]) {
      expect(text).toMatch(/[Ss]igned in|signed in/);
      expect(text).toContain("paid");
      expect(text).toContain("after offers");
      expect(text.toLowerCase()).not.toContain("every");
    }
  });
});
