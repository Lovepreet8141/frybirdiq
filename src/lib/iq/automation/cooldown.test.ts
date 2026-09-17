import { describe, expect, it } from "vitest";

import { COOLDOWN_MS, mayPropose } from "./cooldown";
import { ACTION_STATUSES, type ActionStatus } from "./state-machine";

const decidedAt = new Date("2026-09-10T09:00:00+05:30");
const after = (ms: number) => new Date(decidedAt.getTime() + ms);
const DAY = 24 * 3600_000;

describe("cooldown (DESIGN-v2-DELTA §4)", () => {
  it("is 7 days after a dismissal and 1 day after an expiry", () => {
    expect(COOLDOWN_MS).toEqual({ dismissed: 7 * DAY, expired: DAY });
  });

  it("allows a first proposal", () => {
    expect(mayPropose(null, decidedAt)).toEqual({ ok: true });
  });

  it.each(["REJECTED", "UNDONE"] as const)("holds %s for 7 days, then releases", (status) => {
    const latest = { status, decidedAt };
    expect(mayPropose(latest, after(7 * DAY - 1))).toEqual({
      ok: false,
      reason: "DISMISSED_COOLDOWN",
      until: after(7 * DAY),
    });
    expect(mayPropose(latest, after(7 * DAY))).toEqual({ ok: true });
  });

  it("holds EXPIRED for 1 day, then lets it re-surface", () => {
    const latest = { status: "EXPIRED" as const, decidedAt };
    expect(mayPropose(latest, after(DAY - 1))).toEqual({ ok: false, reason: "EXPIRED_COOLDOWN", until: after(DAY) });
    expect(mayPropose(latest, after(DAY))).toEqual({ ok: true });
  });

  it("classifies every status", () => {
    const expected: Record<ActionStatus, string> = {
      QUEUED: "OPEN_DUPLICATE",
      PENDING_APPROVAL: "OPEN_DUPLICATE",
      APPROVED: "OPEN_DUPLICATE",
      EXECUTING: "OPEN_DUPLICATE",
      HANDOFF: "OPEN_DUPLICATE",
      REJECTED: "DISMISSED_COOLDOWN",
      UNDONE: "DISMISSED_COOLDOWN",
      EXPIRED: "EXPIRED_COOLDOWN",
      SUCCEEDED: "OK",
      FAILED: "OK",
      SUPERSEDED: "OK",
      CANCELLED: "OK",
    };
    for (const status of ACTION_STATUSES) {
      const result = mayPropose({ status, decidedAt }, after(60_000));
      expect([status, result.ok ? "OK" : result.reason]).toEqual([status, expected[status]]);
    }
  });

  it("keeps an open duplicate blocked however much time passes", () => {
    expect(mayPropose({ status: "PENDING_APPROVAL", decidedAt }, after(365 * DAY))).toEqual({
      ok: false,
      reason: "OPEN_DUPLICATE",
    });
  });
});
