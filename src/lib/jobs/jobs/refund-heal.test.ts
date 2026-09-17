import { afterEach, describe, expect, it, vi } from "vitest";

import type { JobContext } from "../context";
import type { JobReadRepos, JobWriteRepos, RefundHealReport } from "../repos";
import { HEAL_STOP_RESERVE_MS, runRefundFollowUpHeal } from "./refund-heal";

const unused = async (): Promise<never> => {
  throw new Error("not used");
};

function fakeContext(options: { report: RefundHealReport; previousStillOpen?: number | null; remainingMs?: number; stop?: boolean }) {
  const stopChecks: boolean[] = [];
  let commits = 0;
  const writers = {
    healLostRefundFollowUps: async ({ shouldStop }: { shouldStop: () => boolean }) => {
      stopChecks.push(shouldStop());
      return options.report;
    },
  } as unknown as JobWriteRepos;
  const readers = {
    lastRunSummary: async () =>
      options.previousStillOpen === undefined || options.previousStillOpen === null ? null : { still_open: options.previousStillOpen },
    factsHistoryStart: unused,
  } as unknown as JobReadRepos;
  const ctx = {
    orgId: "org-a",
    periodKey: "2026-09-17T10:15",
    period: { start: new Date(0), end: new Date(0) },
    trigger: "TIMER",
    runId: "run-1",
    attempt: 1,
    resumeCursor: null,
    repos: readers,
    commit: async (write: (repos: JobWriteRepos) => Promise<unknown>) => {
      commits += 1;
      return write(writers);
    },
    shouldStop: () => options.stop ?? false,
    remainingMs: () => options.remainingMs ?? 240_000,
  } as unknown as JobContext;
  return { ctx, stopChecks, commits: () => commits };
}

const report = (overrides: Partial<RefundHealReport> = {}): RefundHealReport => ({
  examined: 2,
  healed: 2,
  stillOpen: 0,
  stillOpenRefundIds: [],
  notReached: 0,
  ...overrides,
});

describe("refund-followup-heal adapter (ref-b7)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("heals in one fenced chunk and reports the counts", async () => {
    const f = fakeContext({ report: report({ notReached: 1 }) });
    expect(await runRefundFollowUpHeal(f.ctx)).toEqual({
      status: "COMPLETE",
      rowsWritten: 2,
      summary: { examined: 2, healed: 2, still_open: 0, not_reached: 1 },
    });
    expect(f.commits()).toBe(1);
    expect(f.stopChecks).toEqual([false]);
  });

  it("tells the healer to stop with at least 30 s of the deadline left, or when the runner says stop", async () => {
    for (const [remainingMs, stop, expected] of [
      [HEAL_STOP_RESERVE_MS + 1, false, false],
      [HEAL_STOP_RESERVE_MS - 1, false, true],
      [240_000, true, true],
    ] as const) {
      const f = fakeContext({ report: report(), remainingMs, stop });
      await runRefundFollowUpHeal(f.ctx);
      expect(f.stopChecks).toEqual([expected]);
    }
  });

  it("logs still-open refund ids only, and keeps them out of the numeric summary", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeContext({ report: report({ healed: 1, stillOpen: 1, stillOpenRefundIds: ["refund-7"] }), previousStillOpen: 0 });
    const result = await runRefundFollowUpHeal(f.ctx);
    expect(result).toEqual({ status: "COMPLETE", rowsWritten: 1, summary: { examined: 2, healed: 1, still_open: 1, not_reached: 0 } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("refund-7");
  });

  it("alerts with PARTIAL REFUNDS_STILL_OPEN only when refunds were also still open on the previous run", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const open = report({ healed: 1, stillOpen: 1, stillOpenRefundIds: ["refund-7"] });
    expect(await runRefundFollowUpHeal(fakeContext({ report: open, previousStillOpen: 2 }).ctx)).toMatchObject({
      status: "PARTIAL",
      reason: "REFUNDS_STILL_OPEN",
      summary: { still_open: 1 },
    });
    expect((await runRefundFollowUpHeal(fakeContext({ report: open, previousStillOpen: null }).ctx)).status).toBe("COMPLETE");
    expect((await runRefundFollowUpHeal(fakeContext({ report: report(), previousStillOpen: 5 }).ctx)).status).toBe("COMPLETE");
  });
});
