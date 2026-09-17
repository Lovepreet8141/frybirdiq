import { describe, expect, it } from "vitest";

import { addDays } from "@/lib/iq/metrics";
import { intradayRetentionFirstDate } from "@/lib/iq/metrics/intraday";

import type { JobContext } from "../context";
import type { JobWriteRepos } from "../repos";
import { runIntradayBackfillJob } from "./intraday";

function fakeContext(periodKey: string, resumeCursor: string | null = null) {
  const rebuilt: string[] = [];
  const writers = {
    rebuildIntradayDay: async (date: string) => {
      rebuilt.push(date);
      return { orgId: "org", businessDate: date, definitionVersion: 1, rowsWritten: 0, lockWaits: 0, attempts: 1 };
    },
  } as unknown as JobWriteRepos;
  const ctx = {
    orgId: "org",
    periodKey,
    period: { start: new Date(0), end: new Date(0) },
    trigger: "MANUAL",
    runId: "run",
    attempt: 1,
    codeVersion: "abc1234",
    resumeCursor,
    repos: {} as JobContext["repos"],
    commit: async (write: (repos: JobWriteRepos) => Promise<unknown>) => write(writers),
    shouldStop: () => false,
    remainingMs: () => 240_000,
  } as unknown as JobContext;
  return { ctx, rebuilt };
}

describe("iq-intraday-backfill start cap (RELIABILITY iq2-s7, C7)", () => {
  const today = "2026-09-17";

  it("rebuilds P-56 .. P-1 for yesterday's period, all inside retention", async () => {
    const f = fakeContext(addDays(today, -1));
    await runIntradayBackfillJob(f.ctx, today);
    expect(f.rebuilt[0]).toBe(addDays(today, -57));
    expect(f.rebuilt.at(-1)).toBe(addDays(today, -2));
    expect(f.rebuilt[0]! >= intradayRetentionFirstDate(today)).toBe(true);
  });

  it("starts a manual rerun of an older period at the retention's first date, not at P-56", async () => {
    const period = addDays(today, -10); // P-56 = today-66, three days older than the 63-day retention keeps
    const f = fakeContext(period);
    await runIntradayBackfillJob(f.ctx, today);
    expect(f.rebuilt[0]).toBe(intradayRetentionFirstDate(today));
    expect(f.rebuilt.at(-1)).toBe(addDays(period, -1));
    expect(f.rebuilt.every((date) => date >= intradayRetentionFirstDate(today))).toBe(true);
  });

  it("keeps a resume cursor that is already past the retention's first date", async () => {
    const period = addDays(today, -10);
    const cursor = addDays(today, -20);
    const f = fakeContext(period, cursor);
    await runIntradayBackfillJob(f.ctx, today);
    expect(f.rebuilt[0]).toBe(addDays(cursor, 1));
  });
});
