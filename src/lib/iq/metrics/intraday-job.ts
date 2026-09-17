/**
 * Job bodies for the intraday facts — IQ-2 slice S8, R2.8. Pure over the job
 * context: AUTOMATION-ARCHITECT's adapter (src/lib/jobs/jobs/) passes the
 * context and the day lock budget, and its registry line schedules it.
 *
 * - `runIntradayFactsToday`: one chunk rebuilds all of today's buckets (a
 *   later capture or refund changes earlier ones) and applies the 63-day
 *   retention from the same IST date. Runs inside iq-facts-intraday beside
 *   today's daily facts and trust, sharing their per-day budget (3 steps).
 * - `runIntradayBackfill`: manual. D-56 … D-1, oldest first, one chunk per
 *   day, cursor = the last day done; never today, so it only meets the
 *   intraday writer on a retry across midnight, where the day lock orders them.
 *
 * DAY_LOCK_BUSY (another holder past the budget) ends the run PARTIAL with
 * the chunk and its cursor rolled back and no failure counted. DAY_TIMEOUT is
 * a fault: it propagates and the run records a failure.
 *
 * Summary counts (numbers only): days_planned, days_rebuilt, rows_written,
 * rows_purged, lock_waits, retries, lock_busy_days.
 */

import type { JobContext, JobRunResult } from "@/lib/jobs/context";
import type { DayLockBudget } from "@/lib/jobs/repos";

import { intradayBackfillDates } from "./intraday";

/** What one rebuild reports: the shape of `rebuildIntradayDay`'s result. */
export interface IntradayRebuildOutcome {
  readonly rowsWritten: number;
  readonly lockWaits: number;
  readonly attempts: number;
}

/** The writers these bodies need, bound by the adapter to the run's org, lease and run id. */
export interface IntradayWriteRepos {
  readonly rebuildIntradayDay: (date: string, budget: DayLockBudget) => Promise<IntradayRebuildOutcome>;
  /** Deletes intraday facts older than the retention for `today`; returns rows removed. */
  readonly purgeIntradayFacts: (today: string) => Promise<number>;
}

export interface IntradayJobDeps {
  /** The job runner's per-day budget for the time left, or null when a day cannot start. */
  readonly budgetFor: (remainingMs: number) => DayLockBudget | null;
}

type Counts = Record<string, number>;

/** The IST business date of a day or quarter-hour period key ("2026-09-17", "2026-09-17T05:15"). */
const dateOfPeriodKey = (periodKey: string) => periodKey.slice(0, 10);

/** The adapter maps the repository's DayLockBusyError to an error with this code. */
const isDayLockBusy = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === "DAY_LOCK_BUSY";

const newCounts = (days: number): Counts => ({ days_planned: days, days_rebuilt: 0, rows_written: 0, rows_purged: 0, lock_waits: 0, retries: 0, lock_busy_days: 0 });

const partial = (reason: "DEADLINE" | "DAY_LOCK_BUSY", counts: Counts): JobRunResult => ({ status: "PARTIAL", reason, rowsWritten: counts.rows_written ?? 0, summary: counts });

const complete = (counts: Counts): JobRunResult => ({ status: "COMPLETE", rowsWritten: counts.rows_written ?? 0, summary: counts });

function add(counts: Counts, outcome: IntradayRebuildOutcome): void {
  counts.days_rebuilt! += 1;
  counts.rows_written! += outcome.rowsWritten;
  counts.lock_waits! += outcome.lockWaits;
  counts.retries! += outcome.attempts - 1;
}

/** Today's buckets, rebuilt whole, then the retention purge for the same IST date. */
export async function runIntradayFactsToday(ctx: JobContext<IntradayWriteRepos>, deps: IntradayJobDeps): Promise<JobRunResult> {
  const today = dateOfPeriodKey(ctx.periodKey);
  const counts = newCounts(1);
  const budget = ctx.shouldStop() ? null : deps.budgetFor(ctx.remainingMs());
  if (budget === null) return partial("DEADLINE", counts);
  try {
    const { outcome, purged } = await ctx.commit(async (repos) => {
      const rebuilt = await repos.rebuildIntradayDay(today, budget);
      return { outcome: rebuilt, purged: await repos.purgeIntradayFacts(today) };
    });
    add(counts, outcome);
    counts.rows_purged! += purged;
  } catch (error) {
    if (!isDayLockBusy(error)) throw error;
    counts.lock_busy_days! += 1;
    return partial("DAY_LOCK_BUSY", counts);
  }
  return complete(counts);
}

/** By hand: the 8 weeks before the period's day, oldest first, resumable from the cursor. */
export async function runIntradayBackfill(ctx: JobContext<IntradayWriteRepos>, deps: IntradayJobDeps): Promise<JobRunResult> {
  const dates = intradayBackfillDates(dateOfPeriodKey(ctx.periodKey));
  const counts = newCounts(dates.length);
  for (const date of ctx.resumeCursor === null ? dates : dates.filter((d) => d > ctx.resumeCursor!)) {
    const budget = ctx.shouldStop() ? null : deps.budgetFor(ctx.remainingMs());
    if (budget === null) return partial("DEADLINE", counts);
    try {
      add(counts, await ctx.commit((repos) => repos.rebuildIntradayDay(date, budget), { cursor: date }));
    } catch (error) {
      if (!isDayLockBusy(error)) throw error;
      counts.lock_busy_days! += 1;
      return partial("DAY_LOCK_BUSY", counts);
    }
  }
  return complete(counts);
}
