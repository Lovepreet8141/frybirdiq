/**
 * iq-service-pulse — thin adapter (IQ-2 R2.1) binding IQ-ENGINE's body
 * `runServicePulse` (src/lib/iq/detect/pulse-job.ts) to the job context.
 *
 * It runs on the quarter hour, five minutes after the intraday writer's own
 * quarter (:05/:20/:35/:50), and evaluates the last complete 15-minute bucket.
 * Nothing here decides anything: the opening hours, the freshness of the
 * intraday input, the buckets and the order count all come from ctx.repos, and
 * the fired findings and the cleared keys go through one fenced chunk.
 *
 * There is no upstream gate to translate: a bucket whose writer run has not
 * landed yet ends COMPLETE with `stale_input` and writes nothing, because the
 * next quarter re-reads the same bucket (C8/U3). Nothing is retried, so the
 * job takes no catch-up periods.
 */
import { randomUUID } from "node:crypto";

import { PULSE_JOB_NAME, runServicePulse } from "@/lib/iq/detect/pulse-job";

import type { JobContext, JobRunResult } from "../context";
import { requireCodeVersion } from "./code-version";

/** The registry name and the `producedBy.job` of every insight it writes are one constant. */
export { PULSE_JOB_NAME };

/**
 * The job whose SUCCEEDED runs prove today's intraday buckets are filled to a
 * given instant (RELIABILITY C8/U3). It is the facts intraday job, which
 * rebuilds today's buckets on every quarter; the manual backfill only ever
 * touches earlier days, so it can never make today fresh.
 */
export const INTRADAY_WRITER_JOB = "iq-facts-intraday";

export async function runPulse(ctx: JobContext): Promise<JobRunResult> {
  // Fail before reading anything, with a code that says why, rather than at the write.
  requireCodeVersion(ctx.codeVersion);
  return runServicePulse({
    orgId: ctx.orgId,
    runId: ctx.runId,
    attempt: ctx.attempt,
    codeVersion: ctx.codeVersion,
    now: () => new Date(),
    readOpeningHours: () => ctx.repos.readOpeningHours(),
    intradayFreshAt: (bucketEnd) => ctx.repos.intradayFreshAt(bucketEnd),
    readPulseDays: (dates) => ctx.repos.readPulseDays(dates),
    countPaidOrders: (from, to) => ctx.repos.countPaidOrders(from, to),
    // Owner-supplied closure dates are gated owner input (IQ-2 R2.9); none yet.
    excludedDates: [],
    newId: randomUUID,
    commit: (write) =>
      ctx.commit((repos) =>
        write({
          writeInsight: (insight, options) => repos.writeInsight(insight, options),
          expireInsights: (requests) => repos.expireInsights(requests),
        }),
      ),
  });
}
