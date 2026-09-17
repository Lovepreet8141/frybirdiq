/**
 * refund-followup-heal — thin adapter (ref-b7) scheduling PAYMENT-SAFETY's
 * healLostRefundFollowUps, so a refund whose follow-up was lost (order status,
 * loyalty reversals, money event) finishes without staff.
 *
 * Per org (the runner's unit):
 * 1. a fenced no-op chunk checks the lease and extends it — and is committed
 *    at once, so no transaction or row lock is held while healing
 *    (RELIABILITY ref-b7j: one chunk around the whole heal pinned a pooled
 *    connection and blocked every heartbeat for minutes);
 * 2. the healer runs outside any chunk, one short idempotent transaction per
 *    refund, so a stale attempt repeats nothing. It stops between refunds when
 *    the runner says stop (deadline or lost lease) or fewer than
 *    HEAL_STOP_RESERVE_MS remain, because one follow-up can take ~28 s once
 *    started; refunds it did not reach are counted not_reached for the next run.
 *
 * Summary counts: examined, healed, still_open, not_reached, stuck. The ids of
 * refunds still open go to a warning (ids only) — iq_job_runs.summary holds
 * numbers.
 *
 * Alert (RELIABILITY ref-b7j): every run, after healing, counts the org's
 * stuck follow-ups — unfinished and failed on at least two heals. Above zero,
 * the run ends PARTIAL reason REFUNDS_STILL_OPEN (a counted failure, HTTP 500).
 * The count is state, so it holds across systemd's retries: they exhaust and
 * OnFailure fires. A one-off failure (a heal racing a live retry) never
 * alerts, and the alert clears by itself once the follow-up finishes.
 */
import type { JobContext, JobRunResult } from "../context";

export const REFUND_HEAL_JOB = "refund-followup-heal";

/** One follow-up can take ~28 s once started (PAYMENT-SAFETY); never start one with less than this left. */
export const HEAL_STOP_RESERVE_MS = 30_000;

export async function runRefundFollowUpHeal(ctx: JobContext): Promise<JobRunResult> {
  // Lease check only: the chunk holds nothing once this returns.
  await ctx.commit(async () => undefined);

  const report = await ctx.repos.healLostRefundFollowUps({
    shouldStop: () => ctx.shouldStop() || ctx.remainingMs() < HEAL_STOP_RESERVE_MS,
  });
  const stuck = await ctx.repos.countStuckRefundFollowUps();
  const summary = {
    examined: report.examined,
    healed: report.healed,
    still_open: report.stillOpen,
    not_reached: report.notReached,
    stuck,
  };

  if (report.stillOpen > 0) {
    // Ids only: never an amount, a customer or a reason.
    console.warn(`${REFUND_HEAL_JOB}: org ${ctx.orgId} has ${report.stillOpen} refund follow-up(s) still open: ${report.stillOpenRefundIds.join(", ")} (run ${ctx.runId})`);
  }
  if (stuck > 0) return { status: "PARTIAL", reason: "REFUNDS_STILL_OPEN", rowsWritten: report.healed, summary };
  return { status: "COMPLETE", rowsWritten: report.healed, summary };
}
