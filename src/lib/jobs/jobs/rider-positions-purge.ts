/**
 * rider-positions-purge — deletes rider GPS fixes older than 24 hours (Lane B).
 *
 * Hourly, at :17. The fixes only exist to show the customer where the rider is right now, so they do not outlive a day.
 * The delete is bounded per call and repeated until nothing old is left or the run must stop, so one run never holds a long
 * lock and a backlog clears over a few passes. Safe to repeat: deleting nothing is a normal run.
 *
 * Summary counts: deleted, passes. Counts only; no coordinates or ids ever reach the run record.
 */
import type { JobContext, JobRunResult } from "../context";

export const RIDER_POSITIONS_PURGE_JOB = "rider-positions-purge";

/** One delete pass removes at most the repository's batch; a run stops after this many passes and the next hour continues. */
export const MAX_PURGE_PASSES = 20;

export async function runRiderPositionsPurge(ctx: JobContext): Promise<JobRunResult> {
  // Lease check only: nothing is held while the deletes run (each pass is its own short statement).
  await ctx.commit(async () => undefined);

  let deleted = 0;
  let passes = 0;
  while (passes < MAX_PURGE_PASSES && !ctx.shouldStop()) {
    passes += 1;
    const gone = await ctx.repos.purgeRiderPositions();
    deleted += gone.deleted;
    if (!gone.more) break;
  }
  return { status: "COMPLETE", rowsWritten: deleted, summary: { deleted, passes } };
}
