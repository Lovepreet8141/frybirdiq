/**
 * iq-detect-daily — thin adapter (IQ-2 R2.1) binding IQ-ENGINE's body
 * `runDetectDaily` (src/lib/iq/detect/detect-job.ts) to the job context.
 *
 * Nothing here decides anything: the period's IST day is the day evaluated
 * (D-1, target previous), reads go through ctx.repos, and the fired writes and
 * clear expiries go through one fenced chunk. The body throws
 * UpstreamNotReady (code UPSTREAM_NOT_READY) when facts for the day are not
 * final; the adapter turns it into PARTIAL reason UPSTREAM_NOT_READY. The run
 * still answers 500 and writes nothing (fail closed, RELIABILITY C4), but no
 * failure is counted, so however often systemd retries that night the next
 * night's catch-up unit can still take the period over (RELIABILITY iq2-s7).
 */
import { randomUUID } from "node:crypto";

import { UpstreamNotReady, runDetectDaily } from "@/lib/iq/detect/detect-job";

import type { JobContext, JobRunResult } from "../context";
import { dateOfPeriodKey } from "../facts-plan";
import { requireCodeVersion } from "./code-version";

export { CodeVersionUnknown } from "./code-version";

export async function runDetect(ctx: JobContext): Promise<JobRunResult> {
  // Fail before reading anything, with a code that says why, rather than at the write.
  requireCodeVersion(ctx.codeVersion);
  try {
    return await evaluate(ctx);
  } catch (error) {
    if (!(error instanceof UpstreamNotReady)) throw error;
    return { status: "PARTIAL", reason: "UPSTREAM_NOT_READY", rowsWritten: 0, summary: { upstream_not_ready: 1 } };
  }
}

function evaluate(ctx: JobContext): Promise<JobRunResult> {
  return runDetectDaily({
    orgId: ctx.orgId,
    runId: ctx.runId,
    attempt: ctx.attempt,
    codeVersion: ctx.codeVersion,
    date: dateOfPeriodKey(ctx.periodKey),
    // Owner-supplied closure dates are gated owner input (IQ-2 R2.9); none yet.
    excludedDates: [],
    factsReady: (date) => ctx.repos.factsReadyFor(date),
    readDays: (dates) => ctx.repos.readDetectDays(dates),
    readFoodCostTarget: (date) => ctx.repos.readFoodCostTarget(date),
    newId: randomUUID,
    now: () => new Date(),
    commit: (write) =>
      ctx.commit((repos) =>
        write({
          writeInsight: (insight, options) => repos.writeInsight(insight, options),
          expireInsights: (requests) => repos.expireInsights(requests),
        }),
      ),
  });
}
