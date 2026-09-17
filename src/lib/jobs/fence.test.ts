import { describe, expect, it } from "vitest";

import { LeaseLostError, fenceHolds, isLeaseLost } from "./fence";

const now = new Date("2026-09-17T10:00:00+05:30");
const token = { runId: "run-1", attempt: 2, leaseOwner: "owner-2" };
const row = { id: "run-1", attempt: 2, leaseOwner: "owner-2", status: "RUNNING", leaseExpiresAt: new Date(now.getTime() + 1) };

describe("fence predicate (DESIGN-v2-DELTA §3)", () => {
  it("holds only for the same run, attempt and owner, still RUNNING, lease in the future", () => {
    expect(fenceHolds(row, token, now)).toBe(true);
    expect(fenceHolds({ ...row, id: "run-2" }, token, now)).toBe(false);
    expect(fenceHolds({ ...row, attempt: 3 }, token, now)).toBe(false);
    expect(fenceHolds({ ...row, leaseOwner: "owner-3" }, token, now)).toBe(false);
    expect(fenceHolds({ ...row, status: "FAILED" }, token, now)).toBe(false);
    expect(fenceHolds({ ...row, status: "SUCCEEDED" }, token, now)).toBe(false);
    expect(fenceHolds({ ...row, leaseExpiresAt: now }, token, now)).toBe(false);
  });

  it("identifies a lost lease by type", () => {
    const error = new LeaseLostError(token);
    expect(isLeaseLost(error)).toBe(true);
    expect(error.code).toBe("LEASE_LOST");
    expect(isLeaseLost(new Error("LEASE_LOST"))).toBe(false);
  });
});
