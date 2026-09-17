import { describe, expect, it } from "vitest";

import type { JobContext } from "@/lib/jobs/context";
import type { DayLockBudget } from "@/lib/jobs/repos";

import { type IntradayWriteRepos, runIntradayBackfill, runIntradayFactsToday } from "./intraday-job";

const BUDGET: DayLockBudget = { maxLockWaits: 3, lockWaitTimeoutMs: 1_000, statementTimeoutMs: 2_000, idleInTransactionTimeoutMs: 2_000 };
const deps = { budgetFor: (remainingMs: number) => (remainingMs > 1_000 ? BUDGET : null) };

class Busy extends Error {
  readonly code = "DAY_LOCK_BUSY";
}

interface Fake {
  readonly ctx: JobContext<IntradayWriteRepos>;
  readonly rebuilt: string[];
  readonly cursors: (string | undefined)[];
  purgedFor: string[];
}

function fake(opts: { periodKey: string; cursor?: string | null; busyOn?: string; timeoutOn?: string; remainingMs?: () => number }): Fake {
  const rebuilt: string[] = [];
  const cursors: (string | undefined)[] = [];
  const state: Fake = { rebuilt, cursors, purgedFor: [], ctx: undefined as never };
  const repos: IntradayWriteRepos = {
    rebuildIntradayDay: async (date, budget) => {
      expect(budget).toBe(BUDGET);
      if (date === opts.busyOn) throw new Busy("busy");
      if (date === opts.timeoutOn) throw Object.assign(new Error("timeout"), { code: "DAY_TIMEOUT" });
      rebuilt.push(date);
      return { rowsWritten: 4, lockWaits: 1, attempts: 2 };
    },
    purgeIntradayFacts: async (today) => {
      state.purgedFor.push(today);
      return 7;
    },
  };
  const ctx = {
    orgId: "org",
    periodKey: opts.periodKey,
    runId: "run",
    attempt: 1,
    resumeCursor: opts.cursor ?? null,
    shouldStop: () => false,
    remainingMs: opts.remainingMs ?? (() => 200_000),
    commit: async <T,>(write: (r: IntradayWriteRepos) => Promise<T>, options?: { readonly cursor?: string }) => {
      // A throwing chunk commits nothing, cursor included.
      const value = await write(repos);
      cursors.push(options?.cursor);
      return value;
    },
  } as unknown as JobContext<IntradayWriteRepos>;
  return Object.assign(state, { ctx });
}

describe("runIntradayFactsToday", () => {
  it("rebuilds today's IST date from a quarter-hour key and purges from the same date", async () => {
    const f = fake({ periodKey: "2026-09-17T05:15" });
    const result = await runIntradayFactsToday(f.ctx, deps);
    expect(f.rebuilt).toEqual(["2026-09-17"]);
    expect(f.purgedFor).toEqual(["2026-09-17"]);
    expect(result).toEqual({
      status: "COMPLETE",
      rowsWritten: 4,
      summary: { days_planned: 1, days_rebuilt: 1, rows_written: 4, rows_purged: 7, lock_waits: 1, retries: 1, lock_busy_days: 0 },
    });
  });

  it("ends PARTIAL DAY_LOCK_BUSY without purging when today is held past the budget", async () => {
    const f = fake({ periodKey: "2026-09-17T05:15", busyOn: "2026-09-17" });
    const result = await runIntradayFactsToday(f.ctx, deps);
    expect(result).toMatchObject({ status: "PARTIAL", reason: "DAY_LOCK_BUSY", summary: { lock_busy_days: 1, days_rebuilt: 0 } });
    expect(f.purgedFor).toEqual([]);
  });

  it("ends PARTIAL DEADLINE when there is no time for a day", async () => {
    const f = fake({ periodKey: "2026-09-17T05:15", remainingMs: () => 500 });
    expect(await runIntradayFactsToday(f.ctx, deps)).toMatchObject({ status: "PARTIAL", reason: "DEADLINE" });
    expect(f.rebuilt).toEqual([]);
  });

  it("lets a DAY_TIMEOUT propagate as a fault", async () => {
    const f = fake({ periodKey: "2026-09-17T05:15", timeoutOn: "2026-09-17" });
    await expect(runIntradayFactsToday(f.ctx, deps)).rejects.toMatchObject({ code: "DAY_TIMEOUT" });
  });
});

describe("runIntradayBackfill", () => {
  it("rebuilds D-56 … D-1 oldest first, one chunk per day with the day as cursor, never today", async () => {
    const f = fake({ periodKey: "2026-09-17" });
    const result = await runIntradayBackfill(f.ctx, deps);
    expect(f.rebuilt).toHaveLength(56);
    expect(f.rebuilt[0]).toBe("2026-07-23");
    expect(f.rebuilt.at(-1)).toBe("2026-09-16");
    expect(f.cursors).toEqual(f.rebuilt);
    expect(result).toMatchObject({ status: "COMPLETE", summary: { days_planned: 56, days_rebuilt: 56, rows_written: 224 } });
  });

  it("resumes after the cursor", async () => {
    const f = fake({ periodKey: "2026-09-17", cursor: "2026-09-14" });
    await runIntradayBackfill(f.ctx, deps);
    expect(f.rebuilt).toEqual(["2026-09-15", "2026-09-16"]);
  });

  it("stops PARTIAL DAY_LOCK_BUSY on a held day, keeping the days before it", async () => {
    const f = fake({ periodKey: "2026-09-17", cursor: "2026-09-10", busyOn: "2026-09-13" });
    const result = await runIntradayBackfill(f.ctx, deps);
    expect(f.rebuilt).toEqual(["2026-09-11", "2026-09-12"]);
    expect(f.cursors).toEqual(["2026-09-11", "2026-09-12"]);
    expect(result).toMatchObject({ status: "PARTIAL", reason: "DAY_LOCK_BUSY", summary: { days_rebuilt: 2, lock_busy_days: 1 } });
  });

  it("stops PARTIAL DEADLINE when the time runs out between days", async () => {
    let calls = 0;
    const f = fake({ periodKey: "2026-09-17", remainingMs: () => (++calls > 3 ? 0 : 200_000) });
    const result = await runIntradayBackfill(f.ctx, deps);
    expect(f.rebuilt).toHaveLength(3);
    expect(result).toMatchObject({ status: "PARTIAL", reason: "DEADLINE" });
  });
});

describe("adapter fit", () => {
  it("accepts the runner's context once its writers include the intraday ones", () => {
    // The registry's JobContext<JobWriteRepos> will carry more writers than these bodies use.
    type Wider = IntradayWriteRepos & { readonly recomputeDay: () => Promise<void> };
    const takesWider = (ctx: JobContext<Wider>) => runIntradayFactsToday(ctx, deps);
    expect(typeof takesWider).toBe("function");
  });
});
