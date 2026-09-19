import { afterEach, describe, expect, it, vi } from "vitest";

import type { JobContext } from "../context";
import type { JobReadRepos, RefundHealReport } from "../repos";
import { HEAL_STOP_RESERVE_MS, runRefundFollowUpHeal } from "./refund-heal";

function fakeContext(options: { report: RefundHealReport; remainingMs?: number; stop?: boolean; stuck?: number }) {
  const events: string[] = [];
  const stopChecks: boolean[] = [];
  let inChunk = false;
  const readers = {
    healLostRefundFollowUps: async ({ shouldStop }: { shouldStop: () => boolean }) => {
      events.push(inChunk ? "heal inside a chunk" : "heal outside any chunk");
      stopChecks.push(shouldStop());
      return options.report;
    },
    countStuckRefundFollowUps: async () => {
      events.push("count stuck");
      return options.stuck ?? 0;
    },
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
    commit: async (write: (repos: unknown) => Promise<unknown>) => {
      inChunk = true;
      events.push("chunk open");
      try {
        return await write({});
      } finally {
        inChunk = false;
        events.push("chunk committed");
      }
    },
    shouldStop: () => options.stop ?? false,
    remainingMs: () => options.remainingMs ?? 240_000,
  } as unknown as JobContext;
  return { ctx, events, stopChecks };
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

  it("checks the lease with a no-op chunk that is committed before the healer runs outside any chunk (RELIABILITY ref-b7j)", async () => {
    const f = fakeContext({ report: report({ notReached: 1 }) });
    expect(await runRefundFollowUpHeal(f.ctx)).toEqual({
      status: "COMPLETE",
      rowsWritten: 2,
      summary: { examined: 2, healed: 2, still_open: 0, not_reached: 1, stuck: 0 },
    });
    expect(f.events).toEqual(["chunk open", "chunk committed", "heal outside any chunk", "count stuck"]);
  });

  it("tells the healer to stop with at least 30 s of the deadline left, or when the runner says stop", async () => {
    for (const [remainingMs, stop, expected] of [
      [HEAL_STOP_RESERVE_MS, false, false],
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
    const f = fakeContext({ report: report({ healed: 1, stillOpen: 1, stillOpenRefundIds: ["refund-7"] }) });
    expect(await runRefundFollowUpHeal(f.ctx)).toMatchObject({ status: "COMPLETE", summary: { examined: 2, healed: 1, still_open: 1, not_reached: 0, stuck: 0 } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("refund-7");
  });

  it("alerts with PARTIAL REFUNDS_STILL_OPEN whenever the org has stuck follow-ups, even if this run examined none", async () => {
    const f = fakeContext({ report: report({ examined: 0, healed: 0 }), stuck: 1 });
    expect(await runRefundFollowUpHeal(f.ctx)).toEqual({
      status: "PARTIAL",
      reason: "REFUNDS_STILL_OPEN",
      rowsWritten: 0,
      summary: { examined: 0, healed: 0, still_open: 0, not_reached: 0, stuck: 1 },
    });
  });
});
