/**
 * Claim decision — what a run does with the iq_job_runs row it found.
 *
 * DESIGN.md §3 with DESIGN-v2-DELTA.md §3. The store first does
 * `INSERT … ON CONFLICT (job, org_id, period_key) DO NOTHING RETURNING`;
 * if nothing came back it reads the existing row. This table decides:
 *
 * | row                                   | decision  | HTTP |
 * |---------------------------------------|-----------|------|
 * | inserted by us                        | RUN       | —    |
 * | SUCCEEDED or SKIPPED                  | NOOP      | 200  |
 * | RUNNING, lease live                   | BUSY      | 200  |
 * | RUNNING, lease expired, attempts left | TAKEOVER  | —    |
 * | FAILED, attempts left                 | TAKEOVER  | —    |
 * | RUNNING expired or FAILED, at max     | EXHAUSTED | 500  |
 *
 * A takeover is a compare-and-set on the row exactly as read (status,
 * attempt, lease owner); if another worker won, the CAS returns nothing and
 * this run reports BUSY. A zombie at max attempts is closed as FAILED
 * LEASE_EXPIRED by the same kind of CAS, so it stops looking RUNNING.
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
  readonly leaseOwner: string;
  readonly leaseExpiresAt: Date;
  /** Where a run cut short by its deadline stopped; the next attempt resumes here. */
  readonly cursor: string | null;
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
  | { readonly kind: "TAKEOVER"; readonly expected: ExpectedRow; readonly nextAttempt: number; readonly resumeCursor: string | null }
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
      if (row.attempt >= maxAttempts) {
        return { kind: "EXHAUSTED", closeZombie: row.status === "RUNNING" ? expected : null };
      }
      return { kind: "TAKEOVER", expected, nextAttempt: row.attempt + 1, resumeCursor: row.cursor };
    }
  }
}
