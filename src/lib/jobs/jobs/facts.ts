/**
 * The IQ-1 facts jobs: nightly, intraday and backfill runs of ANALYTICS-DATA's
 * recomputeDay, through the job runner.
 *
 * hive/reviews/iq-1/DESIGN.md (S8), REVIEW.md required change 2, and the
 * RELIABILITY condition on recomputeDay's unbounded lock wait: every job
 * checks ctx.shouldStop() before each day, so a run that keeps meeting busy
 * days stops at its deadline, saves its place, and the retry resumes.
 *
 * Each day is one chunk: `ctx.commit` checks the lease, recomputes the day
 * through the org-bound writer and saves the day as the cursor. Days go
 * oldest first, so the cursor is simply the last day done.
 *
 * Summary counts (iq_job_runs.summary, numbers only):
 *   days_planned, days_recomputed, rows_written, lock_waits, retries,
 *   and for nightly parity_checks, parity_mismatches, parity_missing_days.
 */
import type { JobContext, JobRunResult } from "../context";
import { dateOfPeriodKey, datesBetween, nightlyDates, parityRanges, remainingAfter } from "../facts-plan";

type Counts = Record<string, number>;

/** Recomputes `dates` after the cursor, one committed day at a time, until done or told to stop. */
async function recomputeDays(ctx: JobContext, dates: readonly string[]): Promise<{ readonly done: boolean; readonly counts: Counts }> {
  const counts: Counts = { days_planned: dates.length, days_recomputed: 0, rows_written: 0, lock_waits: 0, retries: 0 };
  for (const date of remainingAfter(dates, ctx.resumeCursor)) {
    if (ctx.shouldStop()) return { done: false, counts };
    const result = await ctx.commit((repos) => repos.recomputeDay(date), { cursor: date });
    counts.days_recomputed! += 1;
    counts.rows_written! += result.rowsWritten;
    counts.lock_waits! += result.lockWaits;
    counts.retries! += result.attempts - 1;
  }
  return { done: true, counts };
}

const partial = (counts: Counts): JobRunResult => ({ status: "PARTIAL", rowsWritten: counts.rows_written ?? 0, summary: counts });

/** 03:00 IST: yesterday, the whole current and previous month (at least 35 days), then the P&L sum check per month. */
export async function runFactsNightly(ctx: JobContext): Promise<JobRunResult> {
  const yesterday = dateOfPeriodKey(ctx.periodKey);
  const { done, counts } = await recomputeDays(ctx, nightlyDates(yesterday));
  if (!done) return partial(counts);

  counts.parity_checks = 0;
  counts.parity_mismatches = 0;
  counts.parity_missing_days = 0;
  for (const range of parityRanges(yesterday)) {
    const parity = await ctx.repos.checkFactsParity(range.from, range.to);
    counts.parity_checks += 1;
    counts.parity_mismatches += parity.mismatchedMetrics.length;
    counts.parity_missing_days += parity.missingDays;
  }
  return { status: "COMPLETE", rowsWritten: counts.rows_written ?? 0, summary: counts };
}

/** Every 15 minutes: today only. No catch-up; the next quarter redoes it anyway. */
export async function runFactsIntraday(ctx: JobContext): Promise<JobRunResult> {
  const { done, counts } = await recomputeDays(ctx, [dateOfPeriodKey(ctx.periodKey)]);
  return done ? { status: "COMPLETE", rowsWritten: counts.rows_written ?? 0, summary: counts } : partial(counts);
}

/** By hand: every day from the org's first day of history through the period's day, resumable. */
export async function runFactsBackfill(ctx: JobContext): Promise<JobRunResult> {
  const start = await ctx.repos.factsHistoryStart();
  const end = dateOfPeriodKey(ctx.periodKey);
  const dates = start === null ? [] : datesBetween(start, end);
  const { done, counts } = await recomputeDays(ctx, dates);
  return done ? { status: "COMPLETE", rowsWritten: counts.rows_written ?? 0, summary: counts } : partial(counts);
}
