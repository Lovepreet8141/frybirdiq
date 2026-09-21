import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_DELIVERIES, STALE_HOLD_MINUTES, heldMinutes, isStaleHold } from "./hold";

const now = new Date("2026-09-21T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("rider hold rules (owner decisions, 2026-09-21)", () => {
  it("a rider may hold at most 2 active deliveries, and a delivery not moving for 15 minutes is flagged", () => {
    expect(MAX_ACTIVE_DELIVERIES).toBe(2);
    expect(STALE_HOLD_MINUTES).toBe(15);
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
