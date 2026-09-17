import { describe, expect, it } from "vitest";

import { JOB_RUN_STATUSES, decideClaim, type JobRunRow } from "./claim-decision";

const now = new Date("2026-09-17T10:00:00+05:30");
const at = (s: number) => new Date(now.getTime() + s * 1000);

const row = (overrides: Partial<JobRunRow> = {}): JobRunRow => ({
  id: "run-1",
  status: "RUNNING",
  attempt: 1,
  failures: 0,
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

  it("takes over an expired lease, counting the lost lease as a failure and resuming its cursor", () => {
    expect(decideClaim(existing({ leaseExpiresAt: at(-1), attempt: 2, failures: 1, cursor: "c-42" }), 3, now)).toEqual({
      kind: "TAKEOVER",
      expected: { id: "run-1", status: "RUNNING", attempt: 2, leaseOwner: "owner-1" },
      nextAttempt: 3,
      nextFailures: 2,
      resumeCursor: "c-42",
    });
  });

  it("retries a FAILED run below the failure limit, even if its old lease still looks live", () => {
    expect(decideClaim(existing({ status: "FAILED", attempt: 1, failures: 1, leaseExpiresAt: at(200) }), 3, now)).toEqual({
      kind: "TAKEOVER",
      expected: { id: "run-1", status: "FAILED", attempt: 1, leaseOwner: "owner-1" },
      nextAttempt: 2,
      nextFailures: 1,
      resumeCursor: null,
    });
  });

  it("limits failures, not attempts: a long job cut at its deadline with progress keeps going (M2)", () => {
    expect(decideClaim(existing({ status: "FAILED", attempt: 9, failures: 0, cursor: "c-9" }), 3, now)).toMatchObject({
      kind: "TAKEOVER",
      nextAttempt: 10,
      nextFailures: 0,
      resumeCursor: "c-9",
    });
  });

  it("stops at the failure limit, closing a zombie but not a FAILED row", () => {
    expect(decideClaim(existing({ status: "FAILED", attempt: 3, failures: 3 }), 3, now)).toEqual({
      kind: "EXHAUSTED",
      closeZombie: null,
    });
    expect(decideClaim(existing({ leaseExpiresAt: at(-1), attempt: 3, failures: 2 }), 3, now)).toEqual({
      kind: "EXHAUSTED",
      closeZombie: { id: "run-1", status: "RUNNING", attempt: 3, leaseOwner: "owner-1" },
    });
  });

  it("decides every status × lease live/expired × failures left/at limit", () => {
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
            existing({ status, leaseExpiresAt: at(lease === "live" ? 60 : -60), attempt: 5, failures: attempts === "max" ? 3 : 1 }),
            3,
            now,
          );
          expect([status, lease, attempts, d.kind]).toEqual([status, lease, attempts, expected[`${status}|${lease}|${attempts}`]]);
        }
      }
    }
  });
});
