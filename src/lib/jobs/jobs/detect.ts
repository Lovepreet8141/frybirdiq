/**
 * iq-detect-daily — thin adapter (IQ-2 R2.1) binding IQ-ENGINE's body
 * `runDetectDaily` (src/lib/iq/detect/detect-job.ts) to the job context.
 *
 * Nothing here decides anything: the period's IST day is the day evaluated
 * (D-1, target previous), reads go through ctx.repos, and the fired writes and
 * clear expiries go through one fenced chunk. The body throws
 * UpstreamNotReady (code UPSTREAM_NOT_READY) when facts for the day are not
 * final; it is not caught, so the run fails closed with that error code
 * (RELIABILITY C4) and the timer's catch-up period retries it the next night.
 */
import { randomUUID } from "node:crypto";

import { runDetectDaily } from "@/lib/iq/detect/detect-job";

import type { JobContext, JobRunResult } from "../context";
import { dateOfPeriodKey } from "../facts-plan";

/** Insights record the deployed commit (engine contract: a git sha). */
const GIT_SHA = /^[0-9a-f]{7,40}$/;

/** The deploy did not say which commit it runs (DEPLOY_COMMIT unset), so no insight could be recorded. */
export class CodeVersionUnknown extends Error {
  readonly code = "CODE_VERSION_UNKNOWN";

  constructor() {
    super("deployed commit unknown");
    this.name = "CodeVersionUnknown";
  }
}

export async function runDetect(ctx: JobContext): Promise<JobRunResult> {
  // Fail before reading anything, with a code that says why, rather than at the write.
  if (!GIT_SHA.test(ctx.codeVersion)) throw new CodeVersionUnknown();
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
