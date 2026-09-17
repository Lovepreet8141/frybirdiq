/**
 * iq-intraday-backfill — thin adapter (IQ-2 R2.1) for ANALYTICS-DATA's
 * `runIntradayBackfill` (src/lib/iq/metrics/intraday-job.ts): by hand, the 8
 * weeks before the period's day, one day per chunk, cursor = day.
 *
 * The body's dates (D-56 … D-1) start inside the 63-day retention computed
 * from the same IST date, so the nightly purge never deletes a backfilled day
 * (RELIABILITY C7); a registry test holds that line. Today's buckets are
 * rebuilt by iq-facts-intraday (jobs/facts.ts).
 */
import { runIntradayBackfill } from "@/lib/iq/metrics/intraday-job";

import type { JobContext, JobRunResult } from "../context";
import { dayLockBudget } from "./facts";

export function runIntradayBackfillJob(ctx: JobContext): Promise<JobRunResult> {
  // One locked step per backfilled day: the bucket rebuild.
  return runIntradayBackfill(ctx, { budgetFor: (remainingMs) => dayLockBudget(remainingMs, 1) });
}
