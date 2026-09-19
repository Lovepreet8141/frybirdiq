import { describe, expect, it } from "vitest";
import { type ReadinessRaw, LIMITED_BELOW_PERCENT, buildReadiness, limitedReasons, percentOf, readinessBriefLine } from "./scores";

const z = { numerator: 0, denominator: 0, previousNumerator: 0, previousDenominator: 0 };
const raw = (over: Partial<ReadinessRaw> = {}): ReadinessRaw => ({
  closedSameDay: { numerator: 9, denominator: 10, previousNumerator: 6, previousDenominator: 10 },
  cashRecorded: { numerator: 5, denominator: 5, previousNumerator: 4, previousDenominator: 5 },
  recipeCoverage: { numerator: 12, denominator: 20, previousNumerator: 10, previousDenominator: 20, firstMissingItem: "Nashville Bomb" },
  stockCount: { numerator: 3, denominator: 30, previousNumerator: 0, previousDenominator: 30, daysSinceLastCount: 9 },
  customerAttached: { numerator: 4, denominator: 10, previousNumerator: 4, previousDenominator: 10 },
  ...over,
});
const byId = (r: ReturnType<typeof buildReadiness>, id: string) => r.scores.find((s) => s.id === id)!;

describe("percentOf", () => {
  it("is a whole percent of counts, and null when nothing was measured (never 0 or 100)", () => {
    expect(percentOf(9, 10)).toBe(90);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(0, 0)).toBeNull();
  });
});

describe("a partial result never reads as none or all", () => {
  it("1 of 300 is 1%, 299 of 300 is 99%; only 0 of n and n of n are 0% and 100%", () => {
    expect(percentOf(1, 300)).toBe(1);
    expect(percentOf(299, 300)).toBe(99);
    expect(percentOf(0, 300)).toBe(0);
    expect(percentOf(300, 300)).toBe(100);
  });
  it("so an almost-complete score still gets an action", () => {
    const r = buildReadiness(raw({ closedSameDay: { ...z, numerator: 299, denominator: 300 }, cashRecorded: { ...z, numerator: 2, denominator: 2 }, recipeCoverage: { ...z, numerator: 20, denominator: 20, firstMissingItem: null }, stockCount: { ...z, numerator: 9, denominator: 9, daysSinceLastCount: 1 }, customerAttached: { ...z, numerator: 5, denominator: 5 } }));
    expect(r.action?.scoreId).toBe("closedSameDay");
  });
});

describe("buildReadiness", () => {
  const r = buildReadiness(raw());

  it("five scores, each a percent from its own counts, with the trend in points against the week before", () => {
    expect(r.scores.map((s) => [s.id, s.percent, s.trendPoints])).toEqual([
      ["closedSameDay", 90, 30],
      ["cashRecorded", 100, 20],
      ["recipeCoverage", 60, 10],
      ["stockCount", 10, 10],
      ["customerAttached", 40, 0],
    ]);
  });

  it("states: 80 and above is ok, under 80 is limited", () => {
    expect(LIMITED_BELOW_PERCENT).toBe(80);
    expect(byId(r, "closedSameDay").state).toBe("ok");
    expect(byId(r, "recipeCoverage").state).toBe("limited");
    expect(byId(buildReadiness(raw({ closedSameDay: { ...z, numerator: 4, denominator: 5 } })), "closedSameDay").state).toBe("ok"); // exactly 80
    expect(byId(buildReadiness(raw({ closedSameDay: { ...z, numerator: 79, denominator: 100 } })), "closedSameDay").state).toBe("limited");
  });

  it("overall is the mean of the scores that had data", () => {
    expect(r.overallPercent).toBe(60); // (90+100+60+10+40)/5
    expect(r.basedOn).toBe(5);
  });

  it("a score with no data is 'nodata', is left out of the overall, and is not a zero", () => {
    const partial = buildReadiness(raw({ cashRecorded: z }));
    expect(byId(partial, "cashRecorded")).toMatchObject({ percent: null, state: "nodata", trendPoints: null });
    expect(partial.basedOn).toBe(4);
    expect(partial.overallPercent).toBe(50); // (90+60+10+40)/4
    expect(buildReadiness(raw({ closedSameDay: z, cashRecorded: z, recipeCoverage: { ...z, firstMissingItem: null }, stockCount: { ...z, daysSinceLastCount: null }, customerAttached: z })).overallPercent).toBeNull();
  });

  it("no trend when either week had nothing to measure", () => {
    expect(byId(buildReadiness(raw({ customerAttached: { numerator: 4, denominator: 10, previousNumerator: 0, previousDenominator: 0 } })), "customerAttached").trendPoints).toBeNull();
  });

  it("stock count is red past 7 days, and when nothing has ever been counted", () => {
    expect(byId(r, "stockCount")).toMatchObject({ daysSinceLastCount: 9, red: true });
    expect(byId(buildReadiness(raw({ stockCount: { ...raw().stockCount, daysSinceLastCount: 7 } })), "stockCount").red).toBe(false);
    expect(byId(buildReadiness(raw({ stockCount: { ...raw().stockCount, daysSinceLastCount: 8 } })), "stockCount").red).toBe(true);
    expect(byId(buildReadiness(raw({ stockCount: { ...raw().stockCount, daysSinceLastCount: null } })), "stockCount").red).toBe(true);
  });
});

describe("the one action", () => {
  it("is the weakest measured score, in the owner's terms, with where to go", () => {
    expect(buildReadiness(raw()).action).toEqual({ scoreId: "stockCount", text: "Count your stock and correct anything that differs: the last recorded count was 9 days ago.", href: "/app/inventory", linkLabel: "Open Inventory" });
  });
  it("names the count of what is missing and the first missing item", () => {
    const a = buildReadiness(raw({ stockCount: { ...raw().stockCount, numerator: 30 }, customerAttached: { ...z, numerator: 9, denominator: 10 } })).action;
    expect(a).toMatchObject({ scoreId: "recipeCoverage", href: "/app/inventory" });
    expect(a?.text).toBe("8 of your top 20 items have no recipe saved, starting with Nashville Bomb. Add its ingredients so food cost can be worked out.");
  });
  it("singular wording, and a never-counted stock", () => {
    const a = buildReadiness(raw({ cashRecorded: { ...z, numerator: 4, denominator: 5 }, closedSameDay: { ...z, numerator: 10, denominator: 10 }, recipeCoverage: { ...z, numerator: 20, denominator: 20, firstMissingItem: null }, stockCount: { ...raw().stockCount, numerator: 30, daysSinceLastCount: 0 }, customerAttached: { ...z, numerator: 10, denominator: 10 } })).action;
    expect(a?.text).toBe("1 completed cash order has no cash recorded as received. Record it against the person who took it.");
    expect(buildReadiness(raw({ stockCount: { ...raw().stockCount, numerator: 0, daysSinceLastCount: null }, customerAttached: { ...z, numerator: 10, denominator: 10 }, recipeCoverage: { ...z, numerator: 20, denominator: 20, firstMissingItem: null } })).action?.text).toBe("Count your stock and correct anything that differs: no stock count is on record.");
  });
  it("ties break in the fixed order; unmeasured scores never win", () => {
    const tied = buildReadiness(raw({ closedSameDay: { ...z, numerator: 5, denominator: 10 }, customerAttached: { ...z, numerator: 5, denominator: 10 }, recipeCoverage: { ...z, numerator: 20, denominator: 20, firstMissingItem: null }, stockCount: { ...raw().stockCount, numerator: 30 }, cashRecorded: z }));
    expect(tied.action?.scoreId).toBe("closedSameDay");
  });
  it("there is nothing to do when every measured score is 100%", () => {
    const perfect = buildReadiness({
      closedSameDay: { ...z, numerator: 5, denominator: 5 },
      cashRecorded: { ...z, numerator: 2, denominator: 2 },
      recipeCoverage: { ...z, numerator: 20, denominator: 20, firstMissingItem: null },
      stockCount: { ...z, numerator: 9, denominator: 9, daysSinceLastCount: 1 },
      customerAttached: { ...z, numerator: 5, denominator: 5 },
    });
    expect(perfect.action).toBeNull();
    expect(perfect.overallPercent).toBe(100);
  });
});

describe("limited badges", () => {
  const r = buildReadiness(raw());
  it("a card is limited by each score it rests on that is under 80% or has no data, and says which", () => {
    expect(limitedReasons(r, "netProfit")).toEqual(["Your 20 best sellers with a recipe: 60%", "Stock counts recorded in the last 7 days: 10%"]);
    expect(limitedReasons(r, "paymentMethods")).toEqual([]); // cash 100, closed 90
    expect(limitedReasons(buildReadiness(raw({ cashRecorded: z })), "paymentMethods")).toEqual(["Cash recorded for completed cash orders: no data yet"]);
  });
  it("a card that rests only on healthy scores is not badged", () => {
    expect(limitedReasons(r, "topProducts")).toEqual([]);
  });
  it("79 badges, 80 does not", () => {
    expect(limitedReasons(buildReadiness(raw({ closedSameDay: { ...z, numerator: 79, denominator: 100 } })), "topProducts")).toHaveLength(1);
    expect(limitedReasons(buildReadiness(raw({ closedSameDay: { ...z, numerator: 80, denominator: 100 } })), "topProducts")).toHaveLength(0);
  });
});

describe("the brief line", () => {
  it("carries the overall percent and the one action, all from the scores", () => {
    expect(readinessBriefLine(buildReadiness(raw()))).toBe("IQ readiness 60% (from 5 of 5 scores). Today's action: Count your stock and correct anything that differs: the last recorded count was 9 days ago.");
  });
  it("says so when nothing can be scored yet", () => {
    expect(readinessBriefLine(buildReadiness({ closedSameDay: z, cashRecorded: z, recipeCoverage: { ...z, firstMissingItem: null }, stockCount: { ...z, daysSinceLastCount: null }, customerAttached: z }))).toBe("IQ readiness: not enough recorded data to score yet.");
  });
});
