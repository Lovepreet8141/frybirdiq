import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_DELIVERIES, MAX_TAKES_PER_HOUR, RIDER_LIMIT_BOUNDS, STALE_HOLD_MINUTES, heldMinutes, isStaleHold, riderLimitsError } from "./hold";

const now = new Date("2026-09-21T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("rider hold rules (owner decisions, 2026-09-21)", () => {
  it("a rider may hold at most 2 active deliveries, and a delivery not moving for 15 minutes is flagged", () => {
    expect(MAX_ACTIVE_DELIVERIES).toBe(2);
    expect(STALE_HOLD_MINUTES).toBe(15);
    expect(MAX_TAKES_PER_HOUR).toBe(6); // a bound on taking-and-releasing to read customers' details (red-team review), not an owner figure
  });

  it("flags a taken delivery that has not moved for 15 minutes or more", () => {
    expect(isStaleHold({ riderUserId: "r", status: "READY", lastMovedAt: ago(15) }, now)).toBe(true);
    expect(isStaleHold({ riderUserId: "r", status: "OUT_FOR_DELIVERY", lastMovedAt: ago(90) }, now)).toBe(true);
  });

  it("does not flag one that moved recently (14 minutes 59 seconds is still fine)", () => {
    expect(isStaleHold({ riderUserId: "r", status: "READY", lastMovedAt: new Date(now.getTime() - (15 * 60_000 - 1000)) }, now)).toBe(false);
    expect(isStaleHold({ riderUserId: "r", status: "READY", lastMovedAt: ago(0) }, now)).toBe(false);
  });

  it("only a delivery a rider actually holds, and that is still open, can be stale: unassigned, closed and cooking ones never are", () => {
    expect(isStaleHold({ riderUserId: null, status: "READY", lastMovedAt: ago(60) }, now)).toBe(false);
    for (const status of ["COMPLETED", "CANCELLED", "FAILED", "REFUNDED", "PREPARING", "ACCEPTED"] as const) expect(isStaleHold({ riderUserId: "r", status, lastMovedAt: ago(60) }, now), status).toBe(false);
  });

  it("heldMinutes is whole minutes, never negative", () => {
    expect(heldMinutes(ago(22), now)).toBe(22);
    expect(heldMinutes(new Date(now.getTime() + 60_000), now)).toBe(0);
  });
});

describe("rider limits (editable in Admin)", () => {
  it("the defaults are inside the bounds", () => {
    expect(riderLimitsError({ maxActive: MAX_ACTIVE_DELIVERIES, maxTakesPerHour: MAX_TAKES_PER_HOUR })).toBeNull();
  });
  it("accepts the edges of the bounds", () => {
    const b = RIDER_LIMIT_BOUNDS;
    expect(riderLimitsError({ maxActive: b.activeMin, maxTakesPerHour: b.takesMin })).toBeNull();
    expect(riderLimitsError({ maxActive: b.activeMax, maxTakesPerHour: b.takesMax })).toBeNull();
  });
  it("refuses one past each edge, fractions and NaN, naming the range", () => {
    const b = RIDER_LIMIT_BOUNDS;
    expect(riderLimitsError({ maxActive: b.activeMin - 1, maxTakesPerHour: 6 })).toContain("1 to 5");
    expect(riderLimitsError({ maxActive: b.activeMax + 1, maxTakesPerHour: 6 })).toContain("1 to 5");
    expect(riderLimitsError({ maxActive: 2, maxTakesPerHour: b.takesMin - 1 })).toContain("1 to 20");
    expect(riderLimitsError({ maxActive: 2, maxTakesPerHour: b.takesMax + 1 })).toContain("1 to 20");
    expect(riderLimitsError({ maxActive: 2.5, maxTakesPerHour: 6 })).not.toBeNull();
    expect(riderLimitsError({ maxActive: Number.NaN, maxTakesPerHour: 6 })).not.toBeNull();
    expect(riderLimitsError({ maxActive: 2, maxTakesPerHour: Number.POSITIVE_INFINITY })).not.toBeNull();
  });
});
