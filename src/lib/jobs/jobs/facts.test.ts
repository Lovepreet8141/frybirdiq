import { describe, expect, it } from "vitest";

import type { JobContext } from "../context";
import type { FactsParity, JobReadRepos, JobWriteRepos } from "../repos";
import { runFactsBackfill, runFactsIntraday, runFactsNightly } from "./facts";

type Options = {
  periodKey: string;
  resumeCursor?: string | null;
  stopAfter?: number;
  historyStart?: string | null;
  parity?: FactsParity;
};

/** A fake context recording which days were recomputed, in order, and the cursor each commit carried. */
function fakeContext(options: Options) {
  const recomputed: string[] = [];
  const cursors: (string | undefined)[] = [];
  const parityCalls: [string, string][] = [];
  let commits = 0;
  const writers: JobWriteRepos = {
    recomputeDay: async (date) => {
      recomputed.push(date);
      return { orgId: "org", businessDate: date, definitionVersion: 1, rowsWritten: 20, lockWaits: date.endsWith("-05") ? 1 : 0, attempts: 1 };
    },
    writeInsight: async () => {
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
      cursors.push(commitOptions?.cursor);
      return write(writers);
    },
    shouldStop: () => options.stopAfter !== undefined && commits >= options.stopAfter,
  };
  return { ctx, recomputed, cursors, parityCalls };
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
        lock_waits: 2,
        retries: 0,
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

  it("records parity mismatches and missing days as counts", async () => {
    const f = fakeContext({ periodKey: "2026-09-16", parity: { ok: false, mismatchedMetrics: ["revenue_net", "orders_paid"], missingDays: 1 } });
    const result = await runFactsNightly(f.ctx);
    expect(result.summary).toMatchObject({ parity_checks: 2, parity_mismatches: 4, parity_missing_days: 2 });
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
