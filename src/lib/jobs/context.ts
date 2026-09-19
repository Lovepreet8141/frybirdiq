/**
 * What a job sees while it runs, and what it hands back.
 *
 * A job never gets a database handle (SECURITY condition, DESIGN T5). It
 * reads through `repos` and writes inside `commit`, both bound to the org its
 * run was claimed for (`repos.ts`); the commit is fenced (`fence.ts`). It
 * checks `shouldStop` between chunks so it can return before its deadline.
 */
import type { JobTrigger } from "./claim-decision";
import type { PeriodBounds } from "./period";
import type { JobReadRepos, JobWriteRepos } from "./repos";

export type JobContext<W = JobWriteRepos> = {
  readonly orgId: string;
  readonly periodKey: string;
  readonly period: PeriodBounds;
  readonly trigger: JobTrigger;
  readonly runId: string;
  readonly attempt: number;
  /** The deployed commit this run records (iq_job_runs.code_version, insight producedBy). */
  readonly codeVersion: string;
  /** Where an earlier attempt stopped at its deadline, or null to start from the beginning. */
  readonly resumeCursor: string | null;
  /** Reads, bound to this run's org. */
  readonly repos: JobReadRepos;
  /**
   * Commits one chunk of output in a fenced transaction; `write` receives the
   * writers bound to that transaction, this run's lease and its org. Pass the
   * cursor that follows this chunk and it is saved in the same transaction.
   * Throws `LeaseLostError`.
   */
  commit<T>(write: (repos: W) => Promise<T>, options?: { readonly cursor?: string }): Promise<T>;
  /** True once the deadline has passed or the lease was lost: return PARTIAL now. Commits are refused shortly after. */
  shouldStop(): boolean;
  /** Milliseconds left before the deadline (0 once passed): size any wait inside a chunk to fit. */
  remainingMs(): number;
};

export type JobRunResult =
  | {
      readonly status: "COMPLETE";
      readonly rowsWritten: number;
      readonly summary: Readonly<Record<string, number>>;
    }
  | {
      /**
       * Stopped at the deadline. The next attempt resumes from the cursor of
       * the last chunk that committed — never from anything claimed here.
       */
      readonly status: "PARTIAL";
      /**
       * Why it stopped. DEADLINE counts as a failure unless a chunk committed;
       * DAY_LOCK_BUSY never does — another recompute of the same day was
       * running, which is contention, not a fault (a second one in a row
       * without progress does). UPSTREAM_NOT_READY never does: the input
       * this run depends on is not final yet, and the next scheduled catch-up
       * must still be able to take the period over (RELIABILITY iq2-s7).
       * REFUNDS_STILL_OPEN is an alert (stuck refund follow-ups, state-based)
       * and counts, so systemd's OnFailure fires. RULE_TIMEOUT always counts,
       * even when other rules of the same run committed: a rule that cannot
       * finish inside its statement timeout is a fault, and the count must
       * survive the retries so the run exhausts and OnFailure fires
       * (PAYMENT-SAFETY iq2-s5b, RELIABILITY #1).
       */
      readonly reason?: "DEADLINE" | "DAY_LOCK_BUSY" | "UPSTREAM_NOT_READY" | "REFUNDS_STILL_OPEN" | "RULE_TIMEOUT";
      readonly rowsWritten: number;
      readonly summary: Readonly<Record<string, number>>;
    };
