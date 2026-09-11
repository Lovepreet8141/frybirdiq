import { describe, expect, it } from "vitest";
import { fromRupees } from "@/lib/money";
import {
  STAMP_DISABLED,
  type StampConfig,
  isStampRewardDue,
  isStampRewardEnabled,
  nextStampCount,
  stampRewardValue,
  stampsRequired,
} from "./stamps";

/** FRYBIRD's card: buy 7, the 8th is free. */
const CONFIG: StampConfig = { enabled: true, goal: 8 };

describe("configuration", () => {
  it("is enabled only with a goal above one", () => {
    expect(isStampRewardEnabled(CONFIG)).toBe(true);
    expect(isStampRewardEnabled(STAMP_DISABLED)).toBe(false);
    expect(isStampRewardEnabled({ enabled: true, goal: 1 })).toBe(false);
    expect(isStampRewardEnabled({ enabled: true, goal: 0 })).toBe(false);
  });

  it("needs one fewer stamp than the goal", () => {
    expect(stampsRequired(CONFIG)).toBe(7);
    expect(stampsRequired({ enabled: true, goal: 1 })).toBe(0);
  });
});

describe("eligibility", () => {
  it("is not due below seven stamps", () => {
    for (let count = 0; count < 7; count++) {
      expect(isStampRewardDue(count, CONFIG)).toBe(false);
    }
  });

  it("is due at seven stamps and stays due if it somehow overshoots", () => {
    expect(isStampRewardDue(7, CONFIG)).toBe(true);
    expect(isStampRewardDue(8, CONFIG)).toBe(true);
  });

  it("is never due when the card is off", () => {
    expect(isStampRewardDue(7, STAMP_DISABLED)).toBe(false);
  });
});

describe("counting", () => {
  it("adds one stamp per qualifying order", () => {
    expect(nextStampCount(0, false, CONFIG)).toBe(1);
    expect(nextStampCount(3, false, CONFIG)).toBe(4);
  });

  it("resets to zero on the order that redeems the reward", () => {
    expect(nextStampCount(7, true, CONFIG)).toBe(0);
  });

  it("does not bank a stamp on top of a redemption", () => {
    // Redeemed always wins, regardless of what count came in — the order
    // that used the reward does not also earn one of its own.
    expect(nextStampCount(7, true, CONFIG)).toBe(0);
    expect(nextStampCount(0, true, CONFIG)).toBe(0);
  });

  it("caps at the threshold rather than running past it", () => {
    // Guards a config change between placing and paying an order.
    expect(nextStampCount(7, false, CONFIG)).toBe(7);
    expect(nextStampCount(20, false, CONFIG)).toBe(7);
  });
});

describe("reward value", () => {
  it("is the cheapest unit price on the order", () => {
    const prices = [fromRupees("249"), fromRupees("89"), fromRupees("399")];
    expect(stampRewardValue(prices)).toBe(fromRupees("89"));
  });

  it("is zero for an empty order", () => {
    expect(stampRewardValue([])).toBe(fromRupees("0"));
  });

  it("takes one line's price even when it repeats", () => {
    const prices = [fromRupees("49"), fromRupees("49"), fromRupees("49")];
    expect(stampRewardValue(prices)).toBe(fromRupees("49"));
  });
});
