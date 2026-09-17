/**
 * Lease fencing — the contract that stops a stale run from writing.
 *
 * DESIGN-v2-DELTA.md §3. A run holds a lease: (run id, attempt, lease owner).
 * If it stalls past `lease_expires_at`, another attempt may take the row
 * over. The stalled one may wake up later and keep going; fencing makes every
 * write it attempts fail instead of landing next to the new attempt's output.
 *
 * The contract for the store (the repository, slice S7):
 *
 *   Every output chunk is ONE transaction whose first statement is
 *     UPDATE iq_job_runs
 *        SET heartbeat_at = now(), lease_expires_at = now() + lease
 *      WHERE id = $runId AND attempt = $attempt AND lease_owner = $leaseOwner
 *        AND status = 'RUNNING' AND lease_expires_at > now()
 *     RETURNING id
 *   Zero rows → throw `LeaseLostError`; the transaction rolls back and
 *   nothing in the chunk is written. Time is always the database's now().
 *
 * `fenceHolds` is that WHERE clause as a pure predicate, for tests and fakes.
 */
export type LeaseToken = {
  readonly runId: string;
  readonly attempt: number;
  readonly leaseOwner: string;
};

export class LeaseLostError extends Error {
  readonly code = "LEASE_LOST";

  constructor(readonly token: LeaseToken) {
    super("job run lease lost");
    this.name = "LeaseLostError";
  }
}

export function isLeaseLost(error: unknown): error is LeaseLostError {
  return error instanceof LeaseLostError;
}

/** The columns the fence reads. */
export type FencedRow = {
  readonly id: string;
  readonly attempt: number;
  readonly leaseOwner: string;
  readonly status: string;
  readonly leaseExpiresAt: Date;
};

export function fenceHolds(row: FencedRow, token: LeaseToken, dbNow: Date): boolean {
  return (
    row.id === token.runId &&
    row.attempt === token.attempt &&
    row.leaseOwner === token.leaseOwner &&
    row.status === "RUNNING" &&
    row.leaseExpiresAt.getTime() > dbNow.getTime()
  );
}

/** What a job may call to commit work. Implemented by the store; throws `LeaseLostError`. */
export interface Fence<Tx> {
  /** Runs `write` inside one fenced transaction, extending the lease. */
  commit<T>(token: LeaseToken, leaseSeconds: number, write: (tx: Tx) => Promise<T>): Promise<T>;
  /** Extends the lease without writing output. */
  heartbeat(token: LeaseToken, leaseSeconds: number): Promise<void>;
}
