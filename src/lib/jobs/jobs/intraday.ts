/**
 * iq-intraday-backfill — thin adapter (IQ-2 R2.1) for ANALYTICS-DATA's
 * `runIntradayBackfill` (src/lib/iq/metrics/intraday-job.ts): by hand, the 8
 * weeks before the period's day, one day per chunk, cursor = day.
 *
 * The body plans P-56 … P-1 for the period P. For a manual rerun of an older
 * period (up to 14 days back) the oldest of those days are already outside
 * the 63-day retention counted from today, and the next purge would delete
 * what the backfill rebuilt (RELIABILITY iq2-s7, C7). So the backfill starts at
 * max(P-56, intradayRetentionFirstDate(today)): the adapter moves the resume
 * cursor to the day before the retention's first date, and the body skips
 * every day up to it. Today's buckets are rebuilt by iq-facts-intraday.
 */
import { addDays } from "@/lib/iq/metrics";
import { intradayRetentionFirstDate } from "@/lib/iq/metrics/intraday";
import { runIntradayBackfill } from "@/lib/iq/metrics/intraday-job";

import type { JobContext, JobRunResult } from "../context";
import { periodKeyAt } from "../period";
import { dayLockBudget } from "./facts";

export function runIntradayBackfillJob(ctx: JobContext, today: string = periodKeyAt("day", new Date())): Promise<JobRunResult> {
  const lastPurged = addDays(intradayRetentionFirstDate(today), -1);
  const resumeCursor = ctx.resumeCursor === null || ctx.resumeCursor < lastPurged ? lastPurged : ctx.resumeCursor;
  // One locked step per backfilled day: the bucket rebuild.
  return runIntradayBackfill({ ...ctx, resumeCursor }, { budgetFor: (remainingMs) => dayLockBudget(remainingMs, 1) });
}
