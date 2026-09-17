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
 *            [, cursor = $cursor]          -- when the chunk carries one
 *      WHERE id = $runId AND attempt = $attempt AND lease_owner = $leaseOwner
 *        AND status = 'RUNNING' AND lease_expires_at > now()
 *     RETURNING id
 *   Zero rows → throw `LeaseLostError`; the transaction rolls back and
 *   nothing in the chunk is written. The chunk and its cursor commit together,
 *   so progress survives a crash between chunks.
 *
 * Conditions on the SQL (RELIABILITY review of ff7b92b):
 *   C1 Safety comes from the row lock that first UPDATE takes and holds to
 *      commit, not from a re-check (now() is transaction start). A takeover is
 *        UPDATE … WHERE id AND status AND attempt AND lease_owner
 *          AND (status = 'FAILED' OR lease_expires_at <= now())
 *      so it waits behind an open chunk and then matches nothing.
 *   C2 `finish` is fenced the same way and sets status in that one
 *      statement; a heartbeat still in flight afterwards hits 0 rows.
 *   C3 The pool has at least 2 connections, so a heartbeat does not queue
 *      behind its own open chunk.
 *   C4 Chunks are idempotent (upsert on dedupe_key): a takeover of an expired
 *      RUNNING row resumes from the last saved cursor and may redo a chunk
 *      whose transaction had not committed its cursor.
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
  /** Runs `write` inside one fenced transaction, extending the lease and, if given, saving `cursor` with it. */
  commit<T>(token: LeaseToken, leaseSeconds: number, write: (tx: Tx) => Promise<T>, cursor?: string): Promise<T>;
  /** Extends the lease without writing output. */
  heartbeat(token: LeaseToken, leaseSeconds: number): Promise<void>;
}
