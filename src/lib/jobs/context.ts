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
      readonly rowsWritten: number;
      readonly summary: Readonly<Record<string, number>>;
    };
