import { describe, expect, it } from "vitest";

import { JOB_RUN_STATUSES, decideClaim, type JobRunRow } from "./claim-decision";

const now = new Date("2026-09-17T10:00:00+05:30");
const at = (s: number) => new Date(now.getTime() + s * 1000);

const row = (overrides: Partial<JobRunRow> = {}): JobRunRow => ({
  id: "run-1",
  status: "RUNNING",
  attempt: 1,
  leaseOwner: "owner-1",
  leaseExpiresAt: at(120),
  cursor: null,
  ...overrides,
});

const existing = (overrides: Partial<JobRunRow> = {}) => ({ inserted: false as const, row: row(overrides) });

describe("claim decision table (DESIGN §3)", () => {
  it("runs a row it inserted", () => {
    const r = row();
    expect(decideClaim({ inserted: true, row: r }, 3, now)).toEqual({ kind: "RUN", row: r });
  });

  it("does nothing for a finished period", () => {
    expect(decideClaim(existing({ status: "SUCCEEDED" }), 3, now)).toEqual({ kind: "NOOP" });
    expect(decideClaim(existing({ status: "SKIPPED" }), 3, now)).toEqual({ kind: "NOOP" });
  });

  it("leaves a live run alone, whatever its attempt", () => {
    expect(decideClaim(existing(), 3, now)).toEqual({ kind: "BUSY" });
    expect(decideClaim(existing({ attempt: 3 }), 3, now)).toEqual({ kind: "BUSY" });
  });

  it("treats a lease expiring exactly now as expired (lease_expires_at > now() is live)", () => {
    expect(decideClaim(existing({ leaseExpiresAt: now }), 3, now).kind).toBe("TAKEOVER");
    expect(decideClaim(existing({ leaseExpiresAt: at(0.001) }), 3, now).kind).toBe("BUSY");
  });

  it("takes over an expired lease with attempts left, resuming its cursor", () => {
    expect(decideClaim(existing({ leaseExpiresAt: at(-1), attempt: 2, cursor: "c-42" }), 3, now)).toEqual({
      kind: "TAKEOVER",
      expected: { id: "run-1", status: "RUNNING", attempt: 2, leaseOwner: "owner-1" },
      nextAttempt: 3,
      resumeCursor: "c-42",
    });
  });

  it("retries a FAILED run with attempts left, even if its old lease still looks live", () => {
    expect(decideClaim(existing({ status: "FAILED", attempt: 1, leaseExpiresAt: at(200) }), 3, now)).toEqual({
      kind: "TAKEOVER",
      expected: { id: "run-1", status: "FAILED", attempt: 1, leaseOwner: "owner-1" },
      nextAttempt: 2,
      resumeCursor: null,
    });
  });

  it("stops at max attempts, closing a zombie but not a FAILED row", () => {
    expect(decideClaim(existing({ status: "FAILED", attempt: 3 }), 3, now)).toEqual({ kind: "EXHAUSTED", closeZombie: null });
    expect(decideClaim(existing({ leaseExpiresAt: at(-1), attempt: 3 }), 3, now)).toEqual({
      kind: "EXHAUSTED",
      closeZombie: { id: "run-1", status: "RUNNING", attempt: 3, leaseOwner: "owner-1" },
    });
  });

  it("decides every status × lease live/expired × attempts left/at max", () => {
    const expected: Record<string, string> = {
      "RUNNING|live|left": "BUSY",
      "RUNNING|live|max": "BUSY",
      "RUNNING|expired|left": "TAKEOVER",
      "RUNNING|expired|max": "EXHAUSTED",
      "FAILED|live|left": "TAKEOVER",
      "FAILED|live|max": "EXHAUSTED",
      "FAILED|expired|left": "TAKEOVER",
      "FAILED|expired|max": "EXHAUSTED",
      "SUCCEEDED|live|left": "NOOP",
      "SUCCEEDED|live|max": "NOOP",
      "SUCCEEDED|expired|left": "NOOP",
      "SUCCEEDED|expired|max": "NOOP",
      "SKIPPED|live|left": "NOOP",
      "SKIPPED|live|max": "NOOP",
      "SKIPPED|expired|left": "NOOP",
      "SKIPPED|expired|max": "NOOP",
    };
    for (const status of JOB_RUN_STATUSES) {
      for (const lease of ["live", "expired"] as const) {
        for (const attempts of ["left", "max"] as const) {
          const d = decideClaim(
            existing({ status, leaseExpiresAt: at(lease === "live" ? 60 : -60), attempt: attempts === "max" ? 3 : 1 }),
            3,
            now,
          );
          expect([status, lease, attempts, d.kind]).toEqual([status, lease, attempts, expected[`${status}|${lease}|${attempts}`]]);
        }
      }
    }
  });
});
