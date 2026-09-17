/**
 * What a job sees while it runs, and what it hands back.
 *
 * A job never gets a database handle. It commits work through `commit`,
 * which is fenced (`fence.ts`), and checks `shouldStop` between chunks so it
 * can hand back a cursor before its deadline. The repositories a job may use
 * are closed over its org (`iqRepos(orgId)`) and arrive with slice S7.
 */
import type { JobTrigger } from "./claim-decision";
import type { PeriodBounds } from "./period";

export type JobContext<Tx = unknown> = {
  readonly orgId: string;
  readonly periodKey: string;
  readonly period: PeriodBounds;
  readonly trigger: JobTrigger;
  readonly runId: string;
  readonly attempt: number;
  /** Where an earlier attempt stopped at its deadline, or null to start from the beginning. */
  readonly resumeCursor: string | null;
  /**
   * Commits one chunk of output in a fenced transaction. Pass the cursor that
   * follows this chunk and it is saved in the same transaction. Throws
   * `LeaseLostError`.
   */
  commit<T>(write: (tx: Tx) => Promise<T>, options?: { readonly cursor?: string }): Promise<T>;
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
