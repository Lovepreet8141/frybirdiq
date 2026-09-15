import { describe, expect, it } from "vitest";
import { AT_RISK_DAYS_OF_COVER, assessIngredientStock, assessVelocity, hourlyRate, projectedStockoutInstant, STOCK_RISK_RANK } from "./stockout";

describe("hourlyRate", () => {
  it("divides consumption by the hours it was measured over", () => {
    expect(hourlyRate(700, 70)).toBe(10);
  });

  it("is zero, not NaN or Infinity, when the business was never open across the window", () => {
    expect(hourlyRate(700, 0)).toBe(0);
  });

  it("floors a negative consumption reading at zero rather than projecting restocking as demand", () => {
    expect(hourlyRate(-50, 10)).toBe(0);
  });
});

describe("assessVelocity", () => {
  it("computes days of cover from on-hand and the hourly rate", () => {
    // 2,000 g on hand, consuming 100 g/h → 20 hours → 0.833 days.
    const result = assessVelocity({ onHandBase: 2000, consumedBase: 7000, openHoursInWindow: 70, reorderThresholdBase: null });
    expect(result.ratePerHour).toBe(100);
    expect(result.daysOfCover).toBeCloseTo(2000 / (100 * 24), 6);
  });

  it("has no days-of-cover figure when nothing has sold — infinite cover is not a number worth showing", () => {
    const result = assessVelocity({ onHandBase: 2000, consumedBase: 0, openHoursInWindow: 70, reorderThresholdBase: null });
    expect(result.ratePerHour).toBe(0);
    expect(result.daysOfCover).toBeNull();
    expect(result.atRisk).toBe(false);
  });

  it("flags at-risk once days of cover drops to the threshold", () => {
    // 200 g on hand at 100 g/h is 2 hours of cover — a fraction of a day.
    const result = assessVelocity({ onHandBase: 200, consumedBase: 7000, openHoursInWindow: 70, reorderThresholdBase: null });
    expect(result.daysOfCover).toBeLessThan(AT_RISK_DAYS_OF_COVER);
    expect(result.atRisk).toBe(true);
  });

  it("is not at risk just above the days-of-cover threshold", () => {
    // Rate 10 g/h; on-hand set so cover is just over 2 days (49 hours).
    const result = assessVelocity({ onHandBase: 490, consumedBase: 700, openHoursInWindow: 70, reorderThresholdBase: null });
    expect(result.daysOfCover).toBeCloseTo(49 / 24, 6);
    expect(result.atRisk).toBe(false);
  });

  it("flags at-risk from the manual reorder threshold alone, even with no velocity signal", () => {
    // A newly stocked ingredient with zero sales history — rate is 0, so
    // days-of-cover can't fire, but the owner's own floor still can.
    const result = assessVelocity({ onHandBase: 400, consumedBase: 0, openHoursInWindow: 70, reorderThresholdBase: 500 });
    expect(result.ratePerHour).toBe(0);
    expect(result.belowReorderThreshold).toBe(true);
    expect(result.atRisk).toBe(true);
  });

  it("does not flag the reorder threshold when on-hand is comfortably above it", () => {
    const result = assessVelocity({ onHandBase: 5000, consumedBase: 0, openHoursInWindow: 70, reorderThresholdBase: 500 });
    expect(result.belowReorderThreshold).toBe(false);
    expect(result.atRisk).toBe(false);
  });
});

describe("projectedStockoutInstant", () => {
  const closing = new Date("2026-09-10T17:30:00Z"); // 23:00 IST

  it("projects a same-day clock time when the rate would exhaust stock before closing", () => {
    // 2,000 g on hand at 500 g/h → 4 hours from now.
    const now = new Date("2026-09-10T12:00:00Z");
    const instant = projectedStockoutInstant(2000, 500, now, closing);
    expect(instant).toEqual(new Date("2026-09-10T16:00:00Z"));
  });

  it("mirrors the roadmap's own shape: on-hand under the rest-of-day projected demand means a same-day time", () => {
    // Chicken: 6 kg on hand, current rate would use 7.8 kg for the rest of
    // today (10 hours left before close) — 6 kg runs out first.
    const now = new Date("2026-09-10T07:30:00Z"); // 10 hours before the 17:30Z (23:00 IST) close
    const ratePerHour = 7800 / 10; // g/h implied by "7.8 kg projected" over the remaining hours
    const hoursRemaining = (closing.getTime() - now.getTime()) / 3_600_000;
    const projectedDemand = ratePerHour * hoursRemaining;
    expect(projectedDemand).toBeCloseTo(7800, 6);

    const instant = projectedStockoutInstant(6000, ratePerHour, now, closing);
    expect(instant).not.toBeNull();
    // Runs out before the close it was measured against.
    expect(instant!.getTime()).toBeLessThan(closing.getTime());
    expect(instant!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("returns null when the projected moment falls after closing — a real risk, but not a clock time today", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    // 6,000 g on hand at 100 g/h would take 60 hours — long past closing.
    expect(projectedStockoutInstant(6000, 100, now, closing)).toBeNull();
  });

  it("returns null exactly at the closing boundary and just past it", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    const hoursToClose = (closing.getTime() - now.getTime()) / 3_600_000;
    const rateThatStocksOutExactlyAtClose = 1000 / hoursToClose;
    expect(projectedStockoutInstant(1000, rateThatStocksOutExactlyAtClose, now, closing)).toEqual(closing);

    const rateJustPastClose = 1000 / (hoursToClose + 0.01);
    expect(projectedStockoutInstant(1000, rateJustPastClose, now, closing)).toBeNull();
  });

  it("returns null when there is no velocity to project from", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    expect(projectedStockoutInstant(2000, 0, now, closing)).toBeNull();
  });

  it("returns null when on-hand is already zero or negative — that is 'already out', not a future projection", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    expect(projectedStockoutInstant(0, 500, now, closing)).toBeNull();
    expect(projectedStockoutInstant(-10, 500, now, closing)).toBeNull();
  });
});

describe("assessIngredientStock", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const closingInstant = new Date("2026-09-10T17:30:00Z");

  it("reads as stockout_today, already out, when on-hand is at zero", () => {
    const result = assessIngredientStock({ onHandBase: 0, consumedBase: 700, openHoursInWindow: 70, reorderThresholdBase: null, now, closingInstant });
    expect(result.risk).toBe("stockout_today");
    expect(result.alreadyOut).toBe(true);
    expect(result.stockoutInstant).toBeNull();
  });

  it("reads as stockout_today with a projected clock time when it will run out before close", () => {
    const result = assessIngredientStock({ onHandBase: 2000, consumedBase: 35_000, openHoursInWindow: 70, reorderThresholdBase: null, now, closingInstant });
    expect(result.ratePerHour).toBe(500);
    expect(result.risk).toBe("stockout_today");
    expect(result.alreadyOut).toBe(false);
    expect(result.stockoutInstant).toEqual(new Date("2026-09-10T16:00:00Z"));
  });

  it("reads as at_risk (days-of-cover) when it will not run out today but is trending low", () => {
    // Rate 10 g/h; on-hand covers only 18 hours (0.75 days) — safely past
    // today's close, but under the 2-day threshold.
    const closeFarAway = new Date("2026-09-10T12:30:00Z"); // closes in 30 minutes, so nothing projects for "today"
    const result = assessIngredientStock({ onHandBase: 180, consumedBase: 700, openHoursInWindow: 70, reorderThresholdBase: null, now, closingInstant: closeFarAway });
    expect(result.risk).toBe("at_risk");
    expect(result.stockoutInstant).toBeNull();
  });

  it("reads as ok when neither signal fires", () => {
    const result = assessIngredientStock({ onHandBase: 50_000, consumedBase: 700, openHoursInWindow: 70, reorderThresholdBase: null, now, closingInstant });
    expect(result.risk).toBe("ok");
  });

  it("the manual reorder threshold alone is enough for at_risk, independent of the clock projection", () => {
    const result = assessIngredientStock({ onHandBase: 400, consumedBase: 0, openHoursInWindow: 70, reorderThresholdBase: 500, now, closingInstant });
    expect(result.belowReorderThreshold).toBe(true);
    expect(result.risk).toBe("at_risk");
  });
});

describe("STOCK_RISK_RANK", () => {
  it("orders ok < at_risk < stockout_today, so the worst of several ingredients can be picked with a max", () => {
    expect(STOCK_RISK_RANK.ok).toBeLessThan(STOCK_RISK_RANK.at_risk);
    expect(STOCK_RISK_RANK.at_risk).toBeLessThan(STOCK_RISK_RANK.stockout_today);
  });
});
