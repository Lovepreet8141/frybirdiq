import { describe, expect, it } from "vitest";
import type { JobContext } from "../context";
import type { JobReadRepos } from "../repos";
import { MAX_PURGE_PASSES, runRiderPositionsPurge } from "./rider-positions-purge";

function fakeContext(batches: readonly { deleted: number; more: boolean }[], stopAfterPasses = Infinity) {
  const calls: string[] = [];
  let pass = 0;
  const repos = {
    purgeRiderPositions: async () => {
      calls.push("purge outside any chunk");
      const next = batches[Math.min(pass, batches.length - 1)]!;
      pass += 1;
      return next;
    },
  } as unknown as JobReadRepos;
  const ctx = {
    orgId: "org-a",
    repos,
    commit: async (write: (r: unknown) => Promise<unknown>) => {
      calls.push("lease check");
      return write({});
    },
    shouldStop: () => pass >= stopAfterPasses,
    remainingMs: () => 240_000,
  } as unknown as JobContext;
  return { ctx, calls };
}

describe("rider-positions-purge", () => {
  it("checks the lease, then deletes outside any chunk, and reports counts only", async () => {
    const { ctx, calls } = fakeContext([{ deleted: 12, more: false }]);
    const result = await runRiderPositionsPurge(ctx);
    expect(calls).toEqual(["lease check", "purge outside any chunk"]);
    expect(result).toEqual({ status: "COMPLETE", rowsWritten: 12, summary: { deleted: 12, passes: 1 } });
  });

  it("a run with nothing old is a normal COMPLETE run", async () => {
    const { ctx } = fakeContext([{ deleted: 0, more: false }]);
    expect(await runRiderPositionsPurge(ctx)).toMatchObject({ status: "COMPLETE", rowsWritten: 0 });
  });

  it("keeps going while batches are full, and stops when one is not", async () => {
    const { ctx } = fakeContext([{ deleted: 5000, more: true }, { deleted: 5000, more: true }, { deleted: 40, more: false }]);
    expect((await runRiderPositionsPurge(ctx)).summary).toEqual({ deleted: 10040, passes: 3 });
  });

  it("stops at the pass ceiling so one run never goes on forever", async () => {
    const { ctx } = fakeContext([{ deleted: 5000, more: true }]);
    expect((await runRiderPositionsPurge(ctx)).summary).toEqual({ deleted: 5000 * MAX_PURGE_PASSES, passes: MAX_PURGE_PASSES });
  });

  it("stops between passes when the runner says stop", async () => {
    const { ctx } = fakeContext([{ deleted: 5000, more: true }], 2);
    expect((await runRiderPositionsPurge(ctx)).summary).toEqual({ deleted: 10000, passes: 2 });
  });
});
