import { describe, expect, it } from "vitest";

import { COOLDOWN_MS, mayPropose } from "./cooldown";
import { ACTION_STATUSES, OPEN_ACTION_STATUSES, type ClosedActionStatus, type OpenActionStatus } from "./state-machine";

const decidedAt = new Date("2026-09-10T09:00:00+05:30");
const after = (ms: number) => new Date(decidedAt.getTime() + ms);
const DAY = 24 * 3600_000;

const closed = (status: ClosedActionStatus, at = decidedAt) => ({ open: null, latestClosed: { status, decidedAt: at } });
const CLOSED = ACTION_STATUSES.filter((s): s is ClosedActionStatus => !(OPEN_ACTION_STATUSES as readonly string[]).includes(s));

describe("cooldown (DESIGN-v2-DELTA §4 + RELIABILITY review)", () => {
  it("is 7 days after a dismissal, 1 day after an expiry or a failure", () => {
    expect(COOLDOWN_MS).toEqual({ dismissed: 7 * DAY, expired: DAY, failed: DAY });
  });

  it("allows a first proposal", () => {
    expect(mayPropose({ open: null, latestClosed: null }, decidedAt)).toEqual({ ok: true });
  });

  it("blocks a duplicate while any row is open, even when an older row has cooled down (B2)", () => {
    for (const status of OPEN_ACTION_STATUSES) {
      const history = { open: { status }, latestClosed: { status: "EXPIRED" as const, decidedAt: after(-2 * DAY) } };
      expect(mayPropose(history, decidedAt)).toEqual({ ok: false, reason: "OPEN_DUPLICATE" });
    }
    expect(mayPropose({ open: { status: "PENDING_APPROVAL" }, latestClosed: null }, after(365 * DAY))).toEqual({
      ok: false,
      reason: "OPEN_DUPLICATE",
    });
  });

  it.each(["REJECTED", "UNDONE", "CANCELLED"] as const)("holds %s for 7 days, then releases (B3)", (status) => {
    expect(mayPropose(closed(status), after(7 * DAY - 1))).toEqual({
      ok: false,
      reason: "DISMISSED_COOLDOWN",
      until: after(7 * DAY),
    });
    expect(mayPropose(closed(status), after(7 * DAY))).toEqual({ ok: true });
  });

  it("holds EXPIRED for 1 day and FAILED for 1 day (B3)", () => {
    expect(mayPropose(closed("EXPIRED"), after(DAY - 1))).toEqual({ ok: false, reason: "EXPIRED_COOLDOWN", until: after(DAY) });
    expect(mayPropose(closed("FAILED"), after(DAY - 1))).toEqual({ ok: false, reason: "FAILED_COOLDOWN", until: after(DAY) });
    expect(mayPropose(closed("EXPIRED"), after(DAY))).toEqual({ ok: true });
    expect(mayPropose(closed("FAILED"), after(DAY))).toEqual({ ok: true });
  });

  it("classifies every closed status", () => {
    const expected: Record<ClosedActionStatus, string> = {
      REJECTED: "DISMISSED_COOLDOWN",
      UNDONE: "DISMISSED_COOLDOWN",
      CANCELLED: "DISMISSED_COOLDOWN",
      EXPIRED: "EXPIRED_COOLDOWN",
      FAILED: "FAILED_COOLDOWN",
      SUCCEEDED: "OK",
      SUPERSEDED: "OK",
    };
    expect(CLOSED.sort()).toEqual(Object.keys(expected).sort());
    for (const status of CLOSED) {
      const result = mayPropose(closed(status), after(60_000));
      expect([status, result.ok ? "OK" : result.reason]).toEqual([status, expected[status]]);
    }
  });

  it("types the two inputs apart", () => {
    // @ts-expect-error — an open status is not a closed row
    const wrongClosed: ClosedActionStatus = "PENDING_APPROVAL";
    // @ts-expect-error — a closed status is not an open row
    const wrongOpen: OpenActionStatus = "EXPIRED";
    expect([wrongClosed, wrongOpen]).toHaveLength(2);
  });
});
