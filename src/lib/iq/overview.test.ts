import { describe, expect, it } from "vitest";
import { paise } from "@/lib/money";
import {
  alertSummary,
  attentionCards,
  averageOrder,
  compareOptions,
  costInputsConnected,
  deltaBps,
  excludedNote,
  formatDuration,
  kitchenLoad,
  onTimeRate,
  resolveCompare,
} from "./overview";

describe("compareOptions — what the data can honestly support", () => {
  const today = "2026-09-13";

  it("offers everything but last year to a shop with 5 weeks of trading, and says when last year arrives", () => {
    const options = compareOptions("today", { date: "2026-08-08", source: "settings" }, today);
    expect(options.map((o) => [o.key, o.available])).toEqual([
      ["lw", true],
      ["yd", true],
      ["avg4", true],
      ["ly", false],
    ]);
    expect(options[3]?.reason).toContain("Available");
    expect(options[3]?.reason).toContain("2027");
  });

  it("disables what a 3-day-old shop cannot compare, with the reason", () => {
    const options = compareOptions("today", { date: "2026-09-10", source: "settings" }, today);
    expect(options.find((o) => o.key === "lw")?.available).toBe(false);
    expect(options.find((o) => o.key === "lw")?.reason).toContain("Needs a week of history");
    expect(options.find((o) => o.key === "yd")?.available).toBe(true);
    expect(options.find((o) => o.key === "avg4")?.available).toBe(false);
  });

  it("falls back to the least-demanding option when the opening date is unknown", () => {
    const options = compareOptions("today", { date: null, source: "unknown" }, today);
    expect(options.every((o) => !o.available)).toBe(true);
    expect(options[0]?.reason).toContain("Opening date not set");
    expect(resolveCompare(options, "lw")).toBeNull();
  });

  it("uses previous period for multi-day ranges and refuses a 4-week average for 30 days", () => {
    const options = compareOptions("30d", { date: "2026-01-01", source: "settings" }, today);
    expect(options.map((o) => o.key)).toEqual(["prev", "avg4", "ly"]);
    expect(options[0]?.available).toBe(true);
    expect(options[1]?.available).toBe(false);
    expect(options[1]?.reason).toContain("30-day");
  });

  it("resolves the requested comparison only when it is available", () => {
    const options = compareOptions("7d", { date: "2026-08-08", source: "first-order" }, today);
    expect(resolveCompare(options, "avg4")?.key).toBe("avg4");
    expect(resolveCompare(options, "ly")?.key).toBe("prev");
    expect(resolveCompare(options, undefined)?.key).toBe("prev");
    expect(options[0]?.note).toBe("The 7 days before this range");
  });
});

describe("tile maths", () => {
  it("formats prep time as minutes and seconds, and — for nothing", () => {
    expect(formatDuration(580_000)).toBe("9m 40s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(null)).toBe("—");
  });

  it("reads on-time as a percentage of promised orders, never of nothing", () => {
    expect(onTimeRate(39, 41)).toEqual({ value: "95.1%", sub: "39 of 41 inside promise" });
    expect(onTimeRate(0, 0).value).toBe("—");
  });

  it("measures kitchen load against the capacity setting", () => {
    expect(kitchenLoad(7, 10)).toEqual({ value: "70%", sub: "7 tickets · capacity 10", over: false });
    expect(kitchenLoad(12, 10).over).toBe(true);
    expect(kitchenLoad(3, 0).value).toBe("—");
  });

  it("delta is null from a zero base", () => {
    expect(deltaBps(110n, 100n)).toBe(1000);
    expect(deltaBps(5n, 0n)).toBeNull();
  });

  it("average order is zero with no orders", () => {
    expect(averageOrder(paise(20000), 4)).toBe(paise(5000));
    expect(averageOrder(paise(20000), 0)).toBe(paise(0));
  });
});

describe("attention rules", () => {
  const quiet = {
    late: { count: 0, oldestLateMinutes: 0, inKitchen: 0 },
    prep: { averageMs: null, count: 0 },
    pendingCash: { count: 0, total: paise(0), oldestMinutes: 0 },
    unsold: [],
    daysOfHistory: 36,
    costs: { directRecorded: true, operatingRecorded: true, operatingThisMonth: paise(1500000), costLinesRecorded: 4, costLinesTotal: 4 },
  };

  it("fires nothing when nothing crossed a line", () => {
    expect(attentionCards(quiet)).toEqual([]);
    expect(alertSummary([])).toBe("Nothing needs attention.");
  });

  it("names the numbers behind a late-orders card, using the prep reading as the cause", () => {
    const cards = attentionCards({ ...quiet, late: { count: 2, oldestLateMinutes: 6, inKitchen: 7 }, prep: { averageMs: 580_000, count: 11 } });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.level).toBe("NOW");
    expect(cards[0]?.title).toBe("2 orders are running late");
    expect(cards[0]?.cause).toContain("9m 40s");
    expect(cards[0]?.primary.href).toBe("/app/kds");
  });

  it("only counts items unsold for 7+ days, never-sold included, and flags the priciest", () => {
    const cards = attentionCards({
      ...quiet,
      unsold: [
        { name: "OG Salt Fries", days: 12, isHighestPriced: false },
        { name: "Mac & Cheese", days: 9, isHighestPriced: true },
        { name: "Chicken Tenders", days: 3, isHighestPriced: false },
        { name: "New Wrap", days: null, isHighestPriced: false },
      ],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.level).toBe("THIS WEEK");
    expect(cards[0]?.title).toBe("3 menu items have not sold in 7+ days");
    expect(cards[0]?.cause).toContain("Mac & Cheese is the highest-priced");
  });

  it("does not call a never-sold item stale in a shop younger than 7 days", () => {
    const cards = attentionCards({
      ...quiet,
      daysOfHistory: 3,
      unsold: [
        { name: "New Wrap", days: null, isHighestPriced: false },
        { name: "Old Fries", days: 9, isHighestPriced: false },
      ],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe("1 menu item has not sold in 7+ days");
  });

  it("raises setup when no direct cost is recorded, and orders cards now-first", () => {
    const cards = attentionCards({
      ...quiet,
      pendingCash: { count: 3, total: paise(164000), oldestMinutes: 205 },
      costs: { directRecorded: false, operatingRecorded: true, operatingThisMonth: paise(1500000), costLinesRecorded: 1, costLinesTotal: 4 },
    });
    expect(cards.map((card) => card.level)).toEqual(["TODAY", "SETUP"]);
    expect(cards[0]?.title).toBe("₹1,640 in cash orders is unsettled");
    expect(cards[0]?.evidence).toContain("3h 25m ago");
    expect(cards[1]?.cause).toContain("₹15,000");
    expect(alertSummary(cards)).toBe("1 needs action now · 1 this week");
  });

  it("says profit is overstated, not that it is missing", () => {
    // profit() computes grossProfit = revenue - directCosts. With nothing
    // recorded, gross profit equals revenue, grossMarginBps is 100% and
    // foodCostBps is 0 — the figures are present and flattering, which is more
    // dangerous than their being absent.
    //
    // The copy this replaced read "all show — until these are entered": a word
    // short, and implying the numbers were not there. Nothing pinned it, so
    // nothing caught it.
    const [card] = attentionCards({
      ...quiet,
      costs: { directRecorded: false, operatingRecorded: false, operatingThisMonth: paise(0), costLinesRecorded: 0, costLinesTotal: 4 },
    });

    expect(card?.id).toBe("costs");
    expect(card?.title).toContain("overstated");
    expect(card?.cause).toContain("equals your full revenue");
    expect(card?.cause).toContain("food cost shows 0%");
    // The sentence must not be the truncated one, in either branch.
    expect(card?.cause).not.toContain("all show —");
  });

  it("names the recorded operating spend when there is some", () => {
    const [card] = attentionCards({
      ...quiet,
      costs: { directRecorded: false, operatingRecorded: true, operatingThisMonth: paise(1500000), costLinesRecorded: 1, costLinesTotal: 4 },
    });
    expect(card?.cause).toContain("₹15,000");
    expect(card?.cause).not.toContain("all show —");
  });
});

describe("KPI row notes", () => {
  it("says exactly what was excluded", () => {
    expect(excludedNote({ cancelled: 0, refunded: 0 })).toBe("Excludes nothing — no cancelled or refunded orders");
    expect(excludedNote({ cancelled: 2, refunded: 1 })).toBe("Excludes 2 cancelled and 1 refunded orders");
    expect(excludedNote({ cancelled: 1, refunded: 0 })).toBe("Excludes 1 cancelled order");
  });

  it("counts connected cost inputs", () => {
    expect(costInputsConnected({ purchases: 0, stockCounts: 0, waste: 0, recipeCosts: 0, packaging: 0 })).toEqual({ connected: 0, total: 5 });
    expect(costInputsConnected({ purchases: 2, stockCounts: 0, waste: 1, recipeCosts: 0, packaging: 0 })).toEqual({ connected: 2, total: 5 });
  });
});
