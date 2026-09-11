import { describe, expect, it } from "vitest";
import { ORDER_CHANNELS } from "@/domain/order-channel";
import { fromRupees } from "@/lib/money";
import {
  STAMP_DISABLED,
  type StampConfig,
  isRewardEligibleItem,
  isRewardUnlocked,
  isStampProgramEnabled,
  qualifiesForStamp,
} from "./stamps";

/** FRYBIRD REWARDS: spend over ₹200, 7 stamps, free item up to ₹250. */
const CONFIG: StampConfig = {
  enabled: true,
  stampsRequired: 7,
  minOrderValue: fromRupees("200"),
  maxRewardValue: fromRupees("250"),
};

describe("configuration", () => {
  it("is enabled only with a positive stamp goal", () => {
    expect(isStampProgramEnabled(CONFIG)).toBe(true);
    expect(isStampProgramEnabled(STAMP_DISABLED)).toBe(false);
    expect(isStampProgramEnabled({ ...CONFIG, stampsRequired: 0 })).toBe(false);
  });
});

describe("qualifying spend — the exact boundary the brief specifies", () => {
  it("₹199 does not qualify", () => {
    expect(qualifiesForStamp(fromRupees("199"), CONFIG)).toBe(false);
  });

  it("₹200 exactly does not qualify — strictly greater than, not at least", () => {
    expect(qualifiesForStamp(fromRupees("200"), CONFIG)).toBe(false);
  });

  it("₹201 qualifies", () => {
    expect(qualifiesForStamp(fromRupees("201"), CONFIG)).toBe(true);
  });

  it("₹500 qualifies — same one stamp as ₹201, never more for spending more", () => {
    expect(qualifiesForStamp(fromRupees("500"), CONFIG)).toBe(true);
  });

  it("a paisa over the threshold still qualifies", () => {
    expect(qualifiesForStamp(fromRupees("200.01"), CONFIG)).toBe(true);
  });

  it("never qualifies while the program is off, regardless of spend", () => {
    expect(qualifiesForStamp(fromRupees("5000"), STAMP_DISABLED)).toBe(false);
  });
});

describe("reward unlock", () => {
  it("is not unlocked below seven unconsumed stamps", () => {
    for (let count = 0; count < 7; count++) {
      expect(isRewardUnlocked(count, CONFIG)).toBe(false);
    }
  });

  it("unlocks at exactly seven", () => {
    expect(isRewardUnlocked(7, CONFIG)).toBe(true);
  });

  it("stays unlocked if the count somehow exceeds seven", () => {
    // Should not happen by construction (the repository consumes stamps the
    // moment a cycle completes), but the check itself must not regress if it does.
    expect(isRewardUnlocked(9, CONFIG)).toBe(true);
  });

  it("never unlocks while the program is off", () => {
    expect(isRewardUnlocked(7, STAMP_DISABLED)).toBe(false);
  });
});

describe("redemption eligibility", () => {
  it("an item at exactly ₹250 is eligible", () => {
    expect(isRewardEligibleItem(fromRupees("250"), CONFIG)).toBe(true);
  });

  it("an item under ₹250 is eligible", () => {
    expect(isRewardEligibleItem(fromRupees("89"), CONFIG)).toBe(true);
  });

  it("an item over ₹250 is not eligible", () => {
    expect(isRewardEligibleItem(fromRupees("251"), CONFIG)).toBe(false);
  });

  it("a modifier that pushes the unit price past the cap makes it ineligible", () => {
    // ₹230 base + a ₹30 modifier priced into the line's unit price.
    expect(isRewardEligibleItem(fromRupees("260"), CONFIG)).toBe(false);
  });

  it("nothing is eligible while the program is off", () => {
    expect(isRewardEligibleItem(fromRupees("50"), STAMP_DISABLED)).toBe(false);
  });
});

describe("Swiggy and Zomato orders never earn a stamp", () => {
  /*
   * There is no channel value for an aggregator to earn a stamp through:
   * `awardStampForOrder` (src/lib/repositories/loyalty.ts) takes a qualifying
   * spend and a customer, never a channel, because FRYBIRD sells direct only
   * (src/domain/order-channel.ts) and there is nothing else to branch on.
   *
   * This test is a canary, not a behavioural check on `stamps.ts` itself —
   * it fails the moment someone adds "SWIGGY" or "ZOMATO" to ORDER_CHANNELS
   * without also teaching the award path to exclude it, which is exactly
   * the change that would silently start stamping aggregator orders.
   */
  it("has no aggregator channel to earn a stamp from — FRYBIRD sells direct only", () => {
    expect(ORDER_CHANNELS).toEqual(["DINE_IN", "TAKEAWAY", "ONLINE"]);
  });

  it("rejects Swiggy and Zomato specifically, not just 'whatever is not in the list today'", () => {
    expect(ORDER_CHANNELS).not.toContain("SWIGGY");
    expect(ORDER_CHANNELS).not.toContain("ZOMATO");
  });
});
