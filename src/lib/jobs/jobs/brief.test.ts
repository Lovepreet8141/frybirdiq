import { describe, expect, it } from "vitest";

import type { BriefFiguresRead, BriefPeriods } from "@/lib/iq/brief/brief-job";

import type { JobContext } from "../context";
import type { JobReadRepos, JobWriteRepos } from "../repos";
import { runBrief } from "./brief";

const unused = async (): Promise<never> => {
  throw new Error("not used");
};

/** Every figure absent: the body's own tests cover what it writes when they are not. */
const nothingRead: BriefFiguresRead = { day: {}, monthToDate: null, sameDaysLastMonth: null };

function fakeContext(options: { factsReady: boolean }) {
  const calls: string[] = [];
  let periods: BriefPeriods | null = null;
  const readers: JobReadRepos = {
    factsHistoryStart: unused,
    // No Opening date in this test's org: analytics-start-date clamps nothing, matching the old unclamped briefPeriods.
    readOpenedOn: async () => null,
    checkFactsParity: unused,
    healLostRefundFollowUps: unused,
    countStuckRefundFollowUps: unused,
    purgeRiderPositions: unused,
    factsReadyFor: async (date) => {
      calls.push(`factsReady ${date}`);
      return options.factsReady;
    },
    readDetectDays: unused,
    readFoodCostTarget: unused,
    readOpeningHours: unused,
    intradayFreshAt: unused,
    readPulseDays: unused,
    countPaidOrders: unused,
    readRecon: unused,
    readBriefFigures: async (asked) => {
      periods = asked;
      calls.push(`readFigures ${asked.day.to}`);
      return nothingRead;
    },
    listInsights: unused,
    getInsight: unused,
    readFactFigures: unused,
    listOpenRecommendations: unused,
  };
  const writers = { writeInsight: async () => ({ outcome: "INSERTED" }) } as unknown as JobWriteRepos;
  let commits = 0;
  const ctx: JobContext = {
    orgId: "11111111-1111-4111-8111-111111111111",
    periodKey: "2026-09-11",
    period: { start: new Date(0), end: new Date(0) },
    trigger: "TIMER",
    runId: "22222222-2222-4222-8222-222222222222",
    attempt: 1,
    codeVersion: "abc1234",
    resumeCursor: null,
    repos: readers,
    commit: async (write) => {
      commits += 1;
      return write(writers);
    },
    shouldStop: () => false,
    remainingMs: () => 30_000,
  };
  return { ctx, calls, commits: () => commits, periods: () => periods };
}

describe("iq-brief-daily adapter (IQ-2 R2.1, R2.10)", () => {
  it("reads the period's day and its two month spans, then writes in one fenced chunk", async () => {
    const f = fakeContext({ factsReady: true });
    const result = await runBrief(f.ctx);
    expect(result.status).toBe("COMPLETE");
    expect(f.calls).toEqual(["factsReady 2026-09-11", "readFigures 2026-09-11"]);
    expect(f.periods()).toMatchObject({
      day: { from: "2026-09-11", to: "2026-09-11" },
      monthToDate: { from: "2026-09-01", to: "2026-09-11" },
      sameDaysLastMonth: { from: "2026-08-01", to: "2026-08-11" },
    });
    expect(f.commits()).toBe(1);
  });

  it("fails with CODE_VERSION_UNKNOWN before reading anything when the deployed commit is unknown", async () => {
    const f = fakeContext({ factsReady: true });
    await expect(runBrief({ ...f.ctx, codeVersion: "unversioned" })).rejects.toMatchObject({ code: "CODE_VERSION_UNKNOWN" });
    expect(f.calls).toEqual([]);
  });

  it("stops PARTIAL UPSTREAM_NOT_READY before reading or writing anything when facts are not final", async () => {
    const f = fakeContext({ factsReady: false });
    expect(await runBrief(f.ctx)).toEqual({ status: "PARTIAL", reason: "UPSTREAM_NOT_READY", rowsWritten: 0, summary: { upstream_not_ready: 1 } });
    expect(f.calls).toEqual(["factsReady 2026-09-11"]);
    expect(f.commits()).toBe(0);
  });
});
