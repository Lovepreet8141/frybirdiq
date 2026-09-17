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
 * Lock budget (RELIABILITY, iq1-s7b): each locked step of a day (facts,
 * trust) waits at most MAX_LOCK_WAITS times for another holder of the same
 * day, each wait capped so all waits of both steps fit before the deadline
 * with the commit grace to spare. A day still busy after that stops the run with PARTIAL
 * (DAY_LOCK_BUSY): the chunk rolls back, the cursor stays on the day before,
 * and no failure is counted.
 *
 * Each day's chunk also scores that day's trust signals (computeTrustDay,
 * ANALYTICS-DATA iq1-s8r 3) after its facts, under the same budget.
 *
 * Summary counts (iq_job_runs.summary, numbers only):
 *   days_planned, days_recomputed, rows_written, trust_signals_written,
 *   lock_waits, retries, lock_busy_days, and for nightly parity_ok (1/0),
 *   parity_checks, parity_mismatches, parity_missing_days.
 *
 * A statement or idle timeout inside a day (DayTimeout, DAY_TIMEOUT) is a
 * fault, not contention: it is not caught here, so the run fails with a
 * counted failure and the committed cursor kept.
 *
 * A parity mismatch is recorded (parity_ok 0) and logged with metric ids and
 * dates only; the run still succeeds. Recomputing again would not fix a
 * definition mismatch, so it is not retried (RELIABILITY iq1-s8r E).
 */
import type { JobContext, JobRunResult } from "../context";
import { dateOfPeriodKey, datesBetween, nightlyDates, parityRanges, remainingAfter } from "../facts-plan";
import { DayLockBusy, type DayLockBudget } from "../repos";

export const MAX_LOCK_WAITS = 3;
/** Locked steps per day — facts, then trust — each of which may use its whole budget. */
export const LOCKED_STEPS_PER_DAY = 2;
/** One wait never exceeds this, however much time is left. */
export const MAX_LOCK_WAIT_MS = 60_000;
/** A statement or idle gap never gets more than recomputeDay's own default. */
export const MAX_STATEMENT_TIMEOUT_MS = 30_000;
/** Kept free before the deadline: the runner refuses commits 30 s after it (COMMIT_GRACE_SECONDS). */
export const LOCK_BUDGET_RESERVE_MS = 30_000;
/** Below this per wait, a day is not worth starting. */
const MIN_LOCK_WAIT_MS = 1_000;

/**
 * The budget for each locked step of one day, or null when there is not enough
 * time left to start the day. The time left less the reserve is shared by the
 * steps; within a step, half goes to lock waits (MAX_LOCK_WAITS of them) and
 * half is the statement / idle timeout (ANALYTICS-DATA iq1-s6d), so a hung
 * statement also ends before the deadline.
 */
export function dayLockBudget(remainingMs: number): DayLockBudget | null {
  const perStep = (remainingMs - LOCK_BUDGET_RESERVE_MS) / LOCKED_STEPS_PER_DAY;
  const perWait = Math.floor(Math.min(MAX_LOCK_WAIT_MS, perStep / 2 / MAX_LOCK_WAITS));
  const statementTimeout = Math.floor(Math.min(MAX_STATEMENT_TIMEOUT_MS, perStep / 2));
  if (perWait < MIN_LOCK_WAIT_MS || statementTimeout < MIN_LOCK_WAIT_MS) return null;
  return {
    maxLockWaits: MAX_LOCK_WAITS,
    lockWaitTimeoutMs: perWait,
    statementTimeoutMs: statementTimeout,
    idleInTransactionTimeoutMs: statementTimeout,
  };
}

type Counts = Record<string, number>;

/** Recomputes `dates` after the cursor, one committed day at a time, until done or told to stop. */
type Progress = { readonly done: true; readonly counts: Counts } | { readonly done: false; readonly reason: "DEADLINE" | "DAY_LOCK_BUSY"; readonly counts: Counts };

async function recomputeDays(ctx: JobContext, dates: readonly string[]): Promise<Progress> {
  const counts: Counts = {
    days_planned: dates.length,
    days_recomputed: 0,
    rows_written: 0,
    trust_signals_written: 0,
    lock_waits: 0,
    retries: 0,
    lock_busy_days: 0,
  };
  for (const date of remainingAfter(dates, ctx.resumeCursor)) {
    const budget = ctx.shouldStop() ? null : dayLockBudget(ctx.remainingMs());
    if (budget === null) return { done: false, reason: "DEADLINE", counts };
    let result;
    try {
      result = await ctx.commit(
        async (repos) => {
          const facts = await repos.recomputeDay(date, budget);
          const trust = await repos.computeTrustDay(date, budget);
          return { facts, trust };
        },
        { cursor: date },
      );
    } catch (error) {
      if (!(error instanceof DayLockBusy)) throw error;
      counts.lock_busy_days! += 1;
      return { done: false, reason: "DAY_LOCK_BUSY", counts };
    }
    counts.days_recomputed! += 1;
    counts.rows_written! += result.facts.rowsWritten;
    counts.trust_signals_written! += result.trust.scores.length;
    counts.lock_waits! += result.facts.lockWaits + result.trust.lockWaits;
    counts.retries! += result.facts.attempts - 1 + (result.trust.attempts - 1);
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
    if (!parity.ok) {
      // Ids and dates only: never a figure.
      console.warn(
        `iq-facts-nightly: facts do not match the P&L for org ${ctx.orgId} ${range.from}..${range.to}` +
          ` (metrics: ${parity.mismatchedMetrics.join(", ") || "none"}; missing days: ${parity.missingDays}; run ${ctx.runId})`,
      );
    }
  }
  counts.parity_ok = counts.parity_mismatches === 0 && counts.parity_missing_days === 0 ? 1 : 0;
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
