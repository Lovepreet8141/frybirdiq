import { afterEach, describe, expect, it, vi } from "vitest";

import type { JobContext } from "../context";
import { DayLockBusy, DayTimeout, type DayLockBudget, type FactsParity, type JobReadRepos, type JobWriteRepos } from "../repos";
import { dayLockBudget, runFactsBackfill, runFactsIntraday, runFactsNightly } from "./facts";

type Options = {
  periodKey: string;
  resumeCursor?: string | null;
  stopAfter?: number;
  historyStart?: string | null;
  parity?: FactsParity;
  /** A day whose facts lock stays busy past the budget. */
  busyOn?: string;
  /** A day whose trust lock stays busy past the budget. */
  trustBusyOn?: string;
  /** A day whose facts step times out. */
  timeoutOn?: string;
  remainingMs?: number;
};

/** A fake context recording which days were recomputed, in order, and the cursor each commit carried. */
function fakeContext(options: Options) {
  const recomputed: string[] = [];
  const cursors: (string | undefined)[] = [];
  const parityCalls: [string, string][] = [];
  const budgets: DayLockBudget[] = [];
  const steps: string[] = [];
  let commits = 0;
  const writers: JobWriteRepos = {
    recomputeDay: async (date, budget) => {
      budgets.push(budget);
      if (date === options.busyOn) throw new DayLockBusy(date);
      if (date === options.timeoutOn) throw new DayTimeout(date);
      recomputed.push(date);
      steps.push(`facts ${date}`);
      return { orgId: "org", businessDate: date, definitionVersion: 1, rowsWritten: 20, lockWaits: date.endsWith("-05") ? 1 : 0, attempts: 1 };
    },
    computeTrustDay: async (date, budget) => {
      budgets.push(budget);
      if (date === options.trustBusyOn) throw new DayLockBusy(date);
      steps.push(`trust ${date}`);
      return { orgId: "org", businessDate: date, definitionVersion: 1, scores: [{}, {}, {}] as never, lockWaits: 0, attempts: 1 };
    },
    writeInsight: async () => {
      throw new Error("not used");
    },
    healLostRefundFollowUps: async () => {
      throw new Error("not used");
    },
    proposeRecommendation: async () => {
      throw new Error("not used");
    },
  };
  const unused = async (): Promise<never> => {
    throw new Error("not used");
  };
  const readers: JobReadRepos = {
    factsHistoryStart: async () => options.historyStart ?? null,
    lastRunSummary: unused,
    checkFactsParity: async (from, to) => {
      parityCalls.push([from, to]);
      return options.parity ?? { ok: true, mismatchedMetrics: [], missingDays: 0 };
    },
    listInsights: unused,
    getInsight: unused,
    readFactFigures: unused,
    listOpenRecommendations: unused,
  };
  const ctx: JobContext = {
    orgId: "org",
    periodKey: options.periodKey,
    period: { start: new Date(0), end: new Date(0) },
    trigger: "TIMER",
    runId: "run",
    attempt: 1,
    resumeCursor: options.resumeCursor ?? null,
    repos: readers,
    commit: async (write, commitOptions) => {
      commits += 1;
      const value = await write(writers);
      // Like the real chunk: the cursor is saved only when the write succeeds.
      cursors.push(commitOptions?.cursor);
      return value;
    },
    shouldStop: () => options.stopAfter !== undefined && commits >= options.stopAfter,
    remainingMs: () => options.remainingMs ?? 240_000,
  };
  return { ctx, recomputed, cursors, parityCalls, budgets, steps };
}

describe("iq-facts-nightly", () => {
  it("recomputes the previous and current month oldest first, one committed day at a time, then checks parity per month", async () => {
    const f = fakeContext({ periodKey: "2026-09-16" });
    const result = await runFactsNightly(f.ctx);
    expect(f.recomputed).toHaveLength(47);
    expect(f.recomputed[0]).toBe("2026-08-01");
    expect(f.recomputed.at(-1)).toBe("2026-09-16");
    expect(f.cursors).toEqual(f.recomputed);
    expect(f.parityCalls).toEqual([
      ["2026-08-01", "2026-08-31"],
      ["2026-09-01", "2026-09-16"],
    ]);
    expect(result).toEqual({
      status: "COMPLETE",
      rowsWritten: 47 * 20,
      summary: {
        days_planned: 47,
        days_recomputed: 47,
        rows_written: 940,
        trust_signals_written: 141,
        lock_waits: 2,
        retries: 0,
        lock_busy_days: 0,
        parity_ok: 1,
        parity_checks: 2,
        parity_mismatches: 0,
        parity_missing_days: 0,
      },
    });
  });

  it("stops before the next day when told to, returning PARTIAL without a parity check", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", stopAfter: 10 });
    const result = await runFactsNightly(f.ctx);
    expect(f.recomputed).toHaveLength(10);
    expect(result).toMatchObject({ status: "PARTIAL", summary: { days_recomputed: 10 } });
    expect(f.parityCalls).toEqual([]);
  });

  it("resumes after the committed cursor", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", resumeCursor: "2026-09-10" });
    await runFactsNightly(f.ctx);
    expect(f.recomputed).toEqual(["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("records a parity mismatch as parity_ok 0 and still succeeds, logging metric ids and dates only (RELIABILITY E)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeContext({ periodKey: "2026-09-16", parity: { ok: false, mismatchedMetrics: ["revenue_net", "orders_paid"], missingDays: 1 } });
    const result = await runFactsNightly(f.ctx);
    expect(result.status).toBe("COMPLETE");
    expect(result.summary).toMatchObject({ parity_ok: 0, parity_checks: 2, parity_mismatches: 4, parity_missing_days: 2 });
    expect(warn).toHaveBeenCalledTimes(2);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain("revenue_net, orders_paid");
    expect(message).toContain("2026-08-01..2026-08-31");
    expect(message).not.toMatch(/\d{4,}(?![-\d])/); // no figures, only dates
  });

  it("scores each day's trust right after its facts, in the same chunk", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", resumeCursor: "2026-09-14" });
    await runFactsNightly(f.ctx);
    expect(f.steps).toEqual(["facts 2026-09-15", "trust 2026-09-15", "facts 2026-09-16", "trust 2026-09-16"]);
    expect(f.cursors).toEqual(["2026-09-15", "2026-09-16"]);
  });

  it("stops with DAY_LOCK_BUSY when a day's trust lock is busy, without saving that day as the cursor", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", resumeCursor: "2026-09-13", trustBusyOn: "2026-09-15" });
    const result = await runFactsNightly(f.ctx);
    expect(result).toMatchObject({ status: "PARTIAL", reason: "DAY_LOCK_BUSY", summary: { days_recomputed: 1, lock_busy_days: 1 } });
    expect(f.cursors).toEqual(["2026-09-14"]);
  });
});

describe("iq-facts-intraday", () => {
  it("recomputes only today's date from the quarter-hour period", async () => {
    const f = fakeContext({ periodKey: "2026-09-17T10:15" });
    expect(await runFactsIntraday(f.ctx)).toMatchObject({ status: "COMPLETE", summary: { days_recomputed: 1 } });
    expect(f.recomputed).toEqual(["2026-09-17"]);
    expect(f.parityCalls).toEqual([]);
  });
});

describe("iq-facts-backfill", () => {
  it("recomputes from the first day of history through the period's day, resumably", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", historyStart: "2026-09-12", resumeCursor: "2026-09-13" });
    expect(await runFactsBackfill(f.ctx)).toMatchObject({ status: "COMPLETE", summary: { days_planned: 5, days_recomputed: 3 } });
    expect(f.recomputed).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
  });

  it("does nothing for an org with no history", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", historyStart: null });
    expect(await runFactsBackfill(f.ctx)).toMatchObject({ status: "COMPLETE", rowsWritten: 0, summary: { days_planned: 0 } });
    expect(f.recomputed).toEqual([]);
  });

  it("returns PARTIAL at the deadline", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", historyStart: "2026-01-01", stopAfter: 3 });
    expect(await runFactsBackfill(f.ctx)).toMatchObject({ status: "PARTIAL", summary: { days_recomputed: 3 } });
  });
});

describe("day lock budget (RELIABILITY, iq1-s7b)", () => {
  it("shares the time left less 30 s between both locked steps, half to 3 lock waits and half to the statement/idle timeout", () => {
    expect(dayLockBudget(240_000)).toEqual({
      maxLockWaits: 3,
      lockWaitTimeoutMs: 17_500,
      statementTimeoutMs: 30_000,
      idleInTransactionTimeoutMs: 30_000,
    });
    expect(dayLockBudget(90_000)).toEqual({ maxLockWaits: 3, lockWaitTimeoutMs: 5_000, statementTimeoutMs: 15_000, idleInTransactionTimeoutMs: 15_000 });
    expect(dayLockBudget(42_000)).toEqual({ maxLockWaits: 3, lockWaitTimeoutMs: 1_000, statementTimeoutMs: 3_000, idleInTransactionTimeoutMs: 3_000 });
    for (const remaining of [900_000, 240_000, 90_000, 42_000]) {
      const b = dayLockBudget(remaining)!;
      const perStepWorst = b.maxLockWaits * b.lockWaitTimeoutMs + b.statementTimeoutMs;
      expect(2 * perStepWorst).toBeLessThanOrEqual(remaining - 30_000);
      expect(b.lockWaitTimeoutMs).toBeLessThanOrEqual(60_000);
      expect(b.statementTimeoutMs).toBeLessThanOrEqual(30_000);
    }
    expect(dayLockBudget(41_999)).toBeNull();
    expect(dayLockBudget(0)).toBeNull();
  });

  it("passes the budget sized to the time left to both locked steps of the day", async () => {
    const f = fakeContext({ periodKey: "2026-09-17T10:15", remainingMs: 90_000 });
    await runFactsIntraday(f.ctx);
    const budget = { maxLockWaits: 3, lockWaitTimeoutMs: 5_000, statementTimeoutMs: 15_000, idleInTransactionTimeoutMs: 15_000 };
    expect(f.budgets).toEqual([budget, budget]);
  });

  it("lets a DAY_TIMEOUT propagate so the run fails, keeping the days before it", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", resumeCursor: "2026-09-13", timeoutOn: "2026-09-15" });
    await expect(runFactsNightly(f.ctx)).rejects.toMatchObject({ code: "DAY_TIMEOUT" });
    expect(f.cursors).toEqual(["2026-09-14"]);
  });

  it("stops with PARTIAL DAY_LOCK_BUSY on a busy day, keeping the days before it and not saving that day as the cursor", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", resumeCursor: "2026-09-10", busyOn: "2026-09-13" });
    const result = await runFactsNightly(f.ctx);
    expect(result).toMatchObject({ status: "PARTIAL", reason: "DAY_LOCK_BUSY", summary: { days_recomputed: 2, lock_busy_days: 1 } });
    expect(f.recomputed).toEqual(["2026-09-11", "2026-09-12"]);
    expect(f.cursors).toEqual(["2026-09-11", "2026-09-12"]);
    expect(f.parityCalls).toEqual([]);
  });

  it("does not start a day without enough time for its lock budget, stopping with PARTIAL DEADLINE", async () => {
    const f = fakeContext({ periodKey: "2026-09-17T10:15", remainingMs: 20_000 });
    expect(await runFactsIntraday(f.ctx)).toMatchObject({ status: "PARTIAL", reason: "DEADLINE", summary: { days_recomputed: 0 } });
    expect(f.budgets).toEqual([]);
  });
});
