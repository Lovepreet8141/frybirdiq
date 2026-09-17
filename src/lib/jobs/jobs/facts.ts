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
 * Lock budget (RELIABILITY, iq1-s7b): a day's recompute waits at most
 * MAX_LOCK_WAITS times for another recompute of the same day, each wait
 * capped so all of them fit before the deadline with the commit grace to
 * spare. A day still busy after that stops the run with PARTIAL
 * (DAY_LOCK_BUSY): the chunk rolls back, the cursor stays on the day before,
 * and no failure is counted.
 *
 * Summary counts (iq_job_runs.summary, numbers only):
 *   days_planned, days_recomputed, rows_written, lock_waits, retries,
 *   and for nightly parity_checks, parity_mismatches, parity_missing_days.
 */
import type { JobContext, JobRunResult } from "../context";
import { dateOfPeriodKey, datesBetween, nightlyDates, parityRanges, remainingAfter } from "../facts-plan";
import { DayLockBusy, type DayLockBudget } from "../repos";

export const MAX_LOCK_WAITS = 3;
/** One wait never exceeds this, however much time is left. */
export const MAX_LOCK_WAIT_MS = 60_000;
/** Kept free before the deadline: the runner refuses commits 30 s after it (COMMIT_GRACE_SECONDS). */
export const LOCK_BUDGET_RESERVE_MS = 30_000;
/** Below this per wait, a day is not worth starting. */
const MIN_LOCK_WAIT_MS = 1_000;

/** The wait budget for one day's recompute, or null when there is not enough time left to start one. */
export function dayLockBudget(remainingMs: number): DayLockBudget | null {
  const perWait = Math.floor(Math.min(MAX_LOCK_WAIT_MS, (remainingMs - LOCK_BUDGET_RESERVE_MS) / MAX_LOCK_WAITS));
  return perWait < MIN_LOCK_WAIT_MS ? null : { maxLockWaits: MAX_LOCK_WAITS, lockWaitTimeoutMs: perWait };
}

type Counts = Record<string, number>;

/** Recomputes `dates` after the cursor, one committed day at a time, until done or told to stop. */
type Progress = { readonly done: true; readonly counts: Counts } | { readonly done: false; readonly reason: "DEADLINE" | "DAY_LOCK_BUSY"; readonly counts: Counts };

async function recomputeDays(ctx: JobContext, dates: readonly string[]): Promise<Progress> {
  const counts: Counts = { days_planned: dates.length, days_recomputed: 0, rows_written: 0, lock_waits: 0, retries: 0, lock_busy_days: 0 };
  for (const date of remainingAfter(dates, ctx.resumeCursor)) {
    const budget = ctx.shouldStop() ? null : dayLockBudget(ctx.remainingMs());
    if (budget === null) return { done: false, reason: "DEADLINE", counts };
    let result;
    try {
      result = await ctx.commit((repos) => repos.recomputeDay(date, budget), { cursor: date });
    } catch (error) {
      if (!(error instanceof DayLockBusy)) throw error;
      counts.lock_busy_days! += 1;
      return { done: false, reason: "DAY_LOCK_BUSY", counts };
    }
    counts.days_recomputed! += 1;
    counts.rows_written! += result.rowsWritten;
    counts.lock_waits! += result.lockWaits;
    counts.retries! += result.attempts - 1;
  }
  return { done: true, counts };
}

const partial = (progress: Extract<Progress, { done: false }>): JobRunResult => ({
  status: "PARTIAL",
  reason: progress.reason,
  rowsWritten: progress.counts.rows_written ?? 0,
  summary: progress.counts,
});

/** 03:00 IST: yesterday, the whole current and previous month (at least 35 days), then the P&L sum check per month. */
export async function runFactsNightly(ctx: JobContext): Promise<JobRunResult> {
  const yesterday = dateOfPeriodKey(ctx.periodKey);
  const progress = await recomputeDays(ctx, nightlyDates(yesterday));
  if (!progress.done) return partial(progress);
  const counts = progress.counts;

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
  const progress = await recomputeDays(ctx, [dateOfPeriodKey(ctx.periodKey)]);
  return progress.done ? { status: "COMPLETE", rowsWritten: progress.counts.rows_written ?? 0, summary: progress.counts } : partial(progress);
}

/** By hand: every day from the org's first day of history through the period's day, resumable. */
export async function runFactsBackfill(ctx: JobContext): Promise<JobRunResult> {
  const start = await ctx.repos.factsHistoryStart();
  const end = dateOfPeriodKey(ctx.periodKey);
  const dates = start === null ? [] : datesBetween(start, end);
  const progress = await recomputeDays(ctx, dates);
  return progress.done ? { status: "COMPLETE", rowsWritten: progress.counts.rows_written ?? 0, summary: progress.counts } : partial(progress);
}
