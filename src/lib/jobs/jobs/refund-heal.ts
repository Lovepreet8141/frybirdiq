/**
 * refund-followup-heal — thin adapter (ref-b7) scheduling PAYMENT-SAFETY's
 * healLostRefundFollowUps, so a refund whose follow-up was lost (order status,
 * loyalty reversals, money event) finishes without staff.
 *
 * Per org (the runner's unit), one fenced chunk: the chunk checks the lease,
 * then the healer runs refund by refund in its own transactions. It is asked
 * to stop once fewer than HEAL_STOP_RESERVE_MS remain before the deadline,
 * because one follow-up can still take about 28 s after it starts; refunds it
 * did not reach are counted not_reached and picked up by the next run.
 *
 * Summary counts: examined, healed, still_open, not_reached. The ids of refunds
 * still open go to a warning (ids only) — iq_job_runs.summary holds numbers.
 * Alert: when refunds are still open on this run AND the org's previous run of
 * this job, the run ends PARTIAL reason REFUNDS_STILL_OPEN, which counts as a
 * failure and answers 500, so systemd's OnFailure fires.
 */
import type { JobContext, JobRunResult } from "../context";

export const REFUND_HEAL_JOB = "refund-followup-heal";

/** One follow-up can take ~28 s once started (PAYMENT-SAFETY); never start one with less than this left. */
export const HEAL_STOP_RESERVE_MS = 30_000;

export async function runRefundFollowUpHeal(ctx: JobContext): Promise<JobRunResult> {
  const report = await ctx.commit((repos) =>
    repos.healLostRefundFollowUps({ shouldStop: () => ctx.shouldStop() || ctx.remainingMs() < HEAL_STOP_RESERVE_MS }),
  );
  const summary = {
    examined: report.examined,
    healed: report.healed,
    still_open: report.stillOpen,
    not_reached: report.notReached,
  };

  if (report.stillOpen === 0) return { status: "COMPLETE", rowsWritten: report.healed, summary };

  // Ids only: never an amount, a customer or a reason.
  console.warn(`${REFUND_HEAL_JOB}: org ${ctx.orgId} has ${report.stillOpen} refund follow-up(s) still open: ${report.stillOpenRefundIds.join(", ")} (run ${ctx.runId})`);
  const previous = await ctx.repos.lastRunSummary(REFUND_HEAL_JOB, ctx.periodKey);
  if ((previous?.still_open ?? 0) > 0) {
    return { status: "PARTIAL", reason: "REFUNDS_STILL_OPEN", rowsWritten: report.healed, summary };
  }
  return { status: "COMPLETE", rowsWritten: report.healed, summary };
}
