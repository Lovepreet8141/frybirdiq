/**
 * Claim decision — what a run does with the iq_job_runs row it found.
 *
 * DESIGN.md §3 with DESIGN-v2-DELTA.md §3 and the RELIABILITY review of
 * ff7b92b. The store first does
 * `INSERT … ON CONFLICT (job, org_id, period_key) DO NOTHING RETURNING`;
 * if nothing came back it reads the existing row. This table decides:
 *
 * | row                                        | decision  | HTTP |
 * |--------------------------------------------|-----------|------|
 * | inserted by us                             | RUN       | —    |
 * | SUCCEEDED or SKIPPED                       | NOOP      | 200  |
 * | RUNNING, lease live                        | BUSY      | 200  |
 * | RUNNING, lease expired, failures+1 < max   | TAKEOVER  | —    |
 * | FAILED, failures < max                     | TAKEOVER  | —    |
 * | otherwise                                  | EXHAUSTED | 500  |
 *
 * Two counters, because they answer different questions:
 * - `attempt` is the fencing generation. Every takeover adds one, so a
 *   stalled earlier attempt can never write.
 * - `failures` is what `maxAttempts` limits. A thrown error, a lost lease
 *   found expired, or a deadline cut that made no progress each add one; a
 *   deadline cut whose cursor moved forward does not, so a long job that keeps
 *   making progress is never EXHAUSTED for being long.
 *
 * A takeover is a compare-and-set on the row exactly as read (status,
 * attempt, lease owner); if another worker won, the CAS returns nothing and
 * this run reports BUSY. A zombie that would reach the limit is closed as
 * FAILED LEASE_EXPIRED by the same kind of CAS, so it stops looking RUNNING.
 */
export const JOB_RUN_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export const JOB_TRIGGERS = ["TIMER", "MANUAL", "CATCHUP"] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

/** The columns of an iq_job_runs row the runner reads. */
export type JobRunRow = {
  readonly id: string;
  readonly status: JobRunStatus;
  readonly attempt: number;
  /** Counted failures; what maxAttempts limits. */
  readonly failures: number;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: Date;
  /** The cursor saved with the last committed chunk; the next attempt resumes here. */
  readonly cursor: string | null;
  /** error_code of the last finished attempt (e.g. DEADLINE, DAY_LOCK_BUSY), or null. */
  readonly errorCode: string | null;
};

export type ClaimRead = { readonly inserted: true; readonly row: JobRunRow } | { readonly inserted: false; readonly row: JobRunRow };

/** The CAS a takeover or zombie close must match. */
export type ExpectedRow = {
  readonly id: string;
  readonly status: "RUNNING" | "FAILED";
  readonly attempt: number;
  readonly leaseOwner: string;
};

export type ClaimDecision =
  | { readonly kind: "RUN"; readonly row: JobRunRow }
  | { readonly kind: "NOOP" }
  | { readonly kind: "BUSY" }
  | {
      readonly kind: "TAKEOVER";
      readonly expected: ExpectedRow;
      readonly nextAttempt: number;
      /** A zombie's lost lease counts as a failure; a FAILED row was counted when it finished. */
      readonly nextFailures: number;
      readonly resumeCursor: string | null;
      /** Why the previous attempt ended; a takeover clears it on the row, so it is carried here. */
      readonly previousErrorCode: string | null;
    }
  | { readonly kind: "EXHAUSTED"; readonly closeZombie: ExpectedRow | null };

export function decideClaim(read: ClaimRead, maxAttempts: number, dbNow: Date): ClaimDecision {
  const { row } = read;
  if (read.inserted) return { kind: "RUN", row };

  switch (row.status) {
    case "SUCCEEDED":
    case "SKIPPED":
      return { kind: "NOOP" };
    case "RUNNING":
    case "FAILED": {
      const live = row.status === "RUNNING" && row.leaseExpiresAt.getTime() > dbNow.getTime();
      if (live) return { kind: "BUSY" };
      const expected: ExpectedRow = { id: row.id, status: row.status, attempt: row.attempt, leaseOwner: row.leaseOwner };
      const failures = row.status === "RUNNING" ? row.failures + 1 : row.failures;
      if (failures >= maxAttempts) {
        return { kind: "EXHAUSTED", closeZombie: row.status === "RUNNING" ? expected : null };
      }
      return {
        kind: "TAKEOVER",
        expected,
        nextAttempt: row.attempt + 1,
        nextFailures: failures,
        resumeCursor: row.cursor,
        previousErrorCode: row.status === "FAILED" ? row.errorCode : null,
      };
    }
  }
}
