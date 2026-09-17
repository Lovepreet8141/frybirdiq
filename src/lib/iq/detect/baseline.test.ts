import { describe, expect, it } from "vitest";

import { MIN_BASELINE_POINTS, UNIT_FLOOR, baselineDates, baselineStats, deviationBps, zAtLeast, zAtMost, zCenti } from "./baseline";

describe("baselineDates", () => {
  it("is the same weekday for the previous 8 weeks, across a month boundary", () => {
    expect(baselineDates("2026-09-11")).toEqual([
      "2026-09-04",
      "2026-08-28",
      "2026-08-21",
      "2026-08-14",
      "2026-08-07",
      "2026-07-31",
      "2026-07-24",
      "2026-07-17",
    ]);
  });
});

describe("baselineStats", () => {
  it(`needs at least ${MIN_BASELINE_POINTS} points`, () => {
    expect(baselineStats([1n, 2n, 3n], UNIT_FLOOR.count)).toBeNull();
    expect(baselineStats([1n, 2n, 3n, 4n], UNIT_FLOOR.count)).not.toBeNull();
  });

  it("uses 1.4826 × MAD when it is above the floor", () => {
    const s = baselineStats([600000n, 1400000n, 600000n, 1400000n, 600000n, 1400000n], UNIT_FLOOR.paise)!;
    expect([s.median, s.mad, s.sigmaE4]).toEqual([1000000n, 400000n, 14826n * 400000n]);
  });

  it("floors σ at 5% of the median or the unit floor, whichever is larger", () => {
    expect(baselineStats([1000000n, 1000000n, 1000000n, 1000000n], UNIT_FLOOR.paise)!.sigmaE4).toBe(10000n * 50000n);
    expect(baselineStats([4000000n, 4000000n, 4000000n, 4000000n], UNIT_FLOOR.paise)!.sigmaE4).toBe(10000n * 200000n);
    expect(baselineStats([0n, 0n, 0n, 0n], UNIT_FLOOR.count)!.sigmaE4).toBe(10000n * 3n);
  });
});

describe("z tests are exact at the boundary", () => {
  const flat = baselineStats([1000000n, 1000000n, 1000000n, 1000000n], UNIT_FLOOR.paise)!; // σ = 50000

  it("z ≤ −3 holds at exactly 3σ below and not one paisa above", () => {
    expect(zAtMost(850000n, flat, -3)).toBe(true);
    expect(zAtMost(850001n, flat, -3)).toBe(false);
  });

  it("z ≥ 3 holds at exactly 3σ above and not one paisa below", () => {
    expect(zAtLeast(1150000n, flat, 3)).toBe(true);
    expect(zAtLeast(1149999n, flat, 3)).toBe(false);
  });

  it("reports z in hundredths for summaries", () => {
    expect(zCenti(850000n, flat)).toBe(-300);
    expect(zCenti(1025000n, flat)).toBe(50);
  });
});

describe("deviationBps", () => {
  it("is relative to the median, half away from zero", () => {
    expect(deviationBps(750000n, 1000000n)).toBe(-2500);
    expect(deviationBps(750001n, 1000000n)).toBe(-2500);
    expect(deviationBps(750050n, 1000000n)).toBe(-2500); // −2499.5 rounds away from zero
    expect(deviationBps(750100n, 1000000n)).toBe(-2499);
    expect(deviationBps(1300000n, 1000000n)).toBe(3000);
  });

  it("is null on a zero or negative median", () => {
    expect(deviationBps(5n, 0n)).toBeNull();
    expect(deviationBps(5n, -1n)).toBeNull();
  });
});
