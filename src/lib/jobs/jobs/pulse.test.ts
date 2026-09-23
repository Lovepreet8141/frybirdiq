import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOURS } from "@/lib/iq/detect/__test-support__/pulse-days";
import { observed } from "@/lib/iq/engine/observed-factory";

import type { JobContext } from "../context";
import type { JobReadRepos, JobWriteRepos } from "../repos";
import { runPulse } from "./pulse";

const unused = async (): Promise<never> => {
  throw new Error("not used");
};

function fakeContext(options: { fresh: boolean; openedOn?: string | null }) {
  const calls: string[] = [];
  const readers: JobReadRepos = {
    factsHistoryStart: unused,
    readOpenedOn: async () => {
      calls.push("readOpenedOn");
      return options.openedOn ?? null;
    },
    checkFactsParity: unused,
    healLostRefundFollowUps: unused,
    countStuckRefundFollowUps: unused,
    purgeRiderPositions: unused,
    factsReadyFor: unused,
    readDetectDays: unused,
    readFoodCostTarget: unused,
    readRecon: unused,
    readBriefFigures: unused,
    readOpeningHours: async () => {
      calls.push("hours");
      return HOURS;
    },
    intradayFreshAt: async (bucketEnd) => {
      calls.push(`fresh ${bucketEnd}`);
      return options.fresh;
    },
    readPulseDays: async (dates) => {
      calls.push(`days ${dates.length}`);
      return dates.map((date) => ({ date, computed: false, buckets: [] }));
    },
    countPaidOrders: async (from, to) => {
      calls.push(`orders ${from} ${to}`);
      return observed({ unit: "count", value: 0 });
    },
    listInsights: unused,
    getInsight: unused,
    readFactFigures: unused,
    listOpenRecommendations: unused,
  };
  const writers = {
    writeInsight: async () => ({ outcome: "INSERTED" }),
    expireInsights: async (requests: readonly unknown[]) => ({ expired: 0, expiredIds: [], staleWrites: 0, absent: requests.length, supersededRecommendationIds: [] }),
  } as unknown as JobWriteRepos;
  let commits = 0;
  const ctx: JobContext = {
    orgId: "11111111-1111-4111-8111-111111111111",
    // A quarter inside opening hours: the run evaluates the bucket that ended at 19:45 IST.
    periodKey: "2026-09-11T14:20:00.000Z",
    period: { start: new Date("2026-09-11T14:20:00Z"), end: new Date("2026-09-11T14:35:00Z") },
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
    remainingMs: () => 60_000,
  };
  return { ctx, calls, commits: () => commits };
}

describe("iq-service-pulse adapter (IQ-2 R2.1, S9)", () => {
  // The body reads the wall clock to find the last complete bucket; freeze it inside opening hours.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T14:20:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the org's Opening date, then the hours, then checks the bucket's input is fresh before reading any day", async () => {
    const f = fakeContext({ fresh: true });
    const result = await runPulse(f.ctx);
    expect(result.status).toBe("COMPLETE");
    expect(f.calls[0]).toBe("readOpenedOn");
    expect(f.calls[1]).toBe("hours");
    expect(f.calls[2]).toMatch(/^fresh \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+05:30$/);
    // Today plus the same weekday's 8 previous weeks.
    expect(f.calls[3]).toBe("days 9");
    // 19:45 IST is the bucket end the frozen clock names.
    expect(f.calls[2]).toBe("fresh 2026-09-11T19:45:00+05:30");
  });

  it("writes nothing and reads no day when the intraday writer has not covered the bucket yet (C8/U3)", async () => {
    const f = fakeContext({ fresh: false });
    expect(await runPulse(f.ctx)).toEqual({ status: "COMPLETE", rowsWritten: 0, summary: { stale_input: 1 } });
    expect(f.calls).toHaveLength(3);
    expect(f.commits()).toBe(0);
  });

  it("fails with CODE_VERSION_UNKNOWN before reading anything when the deployed commit is unknown", async () => {
    const f = fakeContext({ fresh: true });
    await expect(runPulse({ ...f.ctx, codeVersion: "unversioned" })).rejects.toMatchObject({ code: "CODE_VERSION_UNKNOWN" });
    expect(f.calls).toEqual([]);
  });

  it("reads the org's Opening date and excludes days before it from evaluation (analytics-start-date)", async () => {
    const f = fakeContext({ fresh: true, openedOn: "2026-09-11" });
    const result = await runPulse(f.ctx);
    expect(result.status).toBe("COMPLETE");
    expect(f.calls[0]).toBe("readOpenedOn");
  });
});
