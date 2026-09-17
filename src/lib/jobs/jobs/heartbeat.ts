/**
 * heartbeat — proves the runner works end to end, and nothing more.
 *
 * Hourly. It commits one empty fenced chunk, so a SUCCEEDED row means the
 * timer fired, auth passed, the claim landed and the lease held. It reads no
 * business data and writes nothing but its own iq_job_runs row.
 */
import type { JobContext, JobRunResult } from "../context";

export async function runHeartbeat(ctx: JobContext): Promise<JobRunResult> {
  await ctx.commit(async () => undefined);
  return { status: "COMPLETE", rowsWritten: 0, summary: { fencedCommits: 1 } };
}
