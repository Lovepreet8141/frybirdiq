import { describe, expect, it } from "vitest";

import { history } from "@/lib/iq/detect/__test-support__/days";

import type { JobContext } from "../context";
import type { JobReadRepos, JobWriteRepos } from "../repos";
import { runDetect } from "./detect";

const unused = async (): Promise<never> => {
  throw new Error("not used");
};

function fakeContext(options: { factsReady: boolean; openedOn?: string | null }) {
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
    factsReadyFor: async (date) => {
      calls.push(`factsReady ${date}`);
      return options.factsReady;
    },
    readDetectDays: async (dates) => {
      calls.push(`readDays ${dates.length} from ${dates[0]}`);
      return history();
    },
    readOpeningHours: unused,
    intradayFreshAt: unused,
    readPulseDays: unused,
    countPaidOrders: unused,
    readFoodCostTarget: async (date) => {
      calls.push(`target ${date}`);
      return null;
    },
    readRecon: unused,
    readBriefFigures: unused,
    listInsights: unused,
    getInsight: unused,
    readFactFigures: unused,
    listOpenRecommendations: unused,
  };
  const writers = {
    writeInsight: async () => ({ outcome: "INSERTED" }),
    expireInsights: async (requests: readonly unknown[]) => {
      calls.push(`expire ${requests.length}`);
      return { expired: 0, expiredIds: [], staleWrites: 0, absent: requests.length, supersededRecommendationIds: [] };
    },
  } as unknown as JobWriteRepos;
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
    remainingMs: () => 60_000,
  };
  return { ctx, calls, commits: () => commits };
}

describe("iq-detect-daily adapter (IQ-2 R2.1, R2.8)", () => {
  it("evaluates the period's day through ctx.repos and writes in one fenced chunk", async () => {
    const f = fakeContext({ factsReady: true });
    const result = await runDetect(f.ctx);
    expect(result.status).toBe("COMPLETE");
    expect(f.calls[0]).toBe("readOpenedOn");
    expect(f.calls[1]).toBe("factsReady 2026-09-11");
    expect(f.calls[2]).toBe("readDays 10 from 2026-09-11");
    expect(f.calls[3]).toBe("target 2026-09-11");
    expect(f.commits()).toBe(1);
  });

  it("fails with CODE_VERSION_UNKNOWN before reading anything when the deployed commit is unknown", async () => {
    const f = fakeContext({ factsReady: true });
    await expect(runDetect({ ...f.ctx, codeVersion: "unversioned" })).rejects.toMatchObject({ code: "CODE_VERSION_UNKNOWN" });
    expect(f.calls).toEqual([]);
  });

  it("stops PARTIAL UPSTREAM_NOT_READY before reading or writing anything when facts are not final (C4, iq2-s7 blocker)", async () => {
    const f = fakeContext({ factsReady: false });
    expect(await runDetect(f.ctx)).toEqual({ status: "PARTIAL", reason: "UPSTREAM_NOT_READY", rowsWritten: 0, summary: { upstream_not_ready: 1 } });
    expect(f.calls).toEqual(["readOpenedOn", "factsReady 2026-09-11"]);
    expect(f.commits()).toBe(0);
  });

  it("reads the org's Opening date and excludes days before it from evaluation (analytics-start-date)", async () => {
    // The whole 8-week baseline window before "today" (2026-09-11) is pre-launch — every history day is excluded, so no baseline can form.
    const f = fakeContext({ factsReady: true, openedOn: "2026-09-11" });
    const result = await runDetect(f.ctx);
    expect(result.status).toBe("COMPLETE");
    expect(f.calls[0]).toBe("readOpenedOn");
  });
});
