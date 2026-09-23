/**
 * iq-brief-daily — thin adapter (IQ-2 R2.1) binding BUSINESS-INTELLIGENCE's
 * body `runBriefDaily` (src/lib/iq/brief/brief-job.ts) to the job context.
 *
 * The brief itself is never stored: `compose.ts` builds it at read time. This
 * job stores the FACTs the brief cites for the period's IST day — the five day
 * figures and net sales over the two month spans — in one fenced chunk.
 *
 * Like detect and reconcile it fails closed while the day's facts are not
 * final: UpstreamNotReady becomes PARTIAL UPSTREAM_NOT_READY, no failure is
 * counted, and the brief never cites a half-built figure.
 */
import { randomUUID } from "node:crypto";

import { UpstreamNotReady, runBriefDaily } from "@/lib/iq/brief/brief-job";
import { BRIEF_JOB_NAME } from "@/lib/iq/brief/keys";

import type { JobContext, JobRunResult } from "../context";
import { dateOfPeriodKey } from "../facts-plan";
import { requireCodeVersion } from "./code-version";

/** The registry name and the `producedBy.job` of every FACT it writes are one constant. */
export { BRIEF_JOB_NAME, UpstreamNotReady };

export async function runBrief(ctx: JobContext): Promise<JobRunResult> {
  // Fail before reading anything, with a code that says why, rather than at the write.
  requireCodeVersion(ctx.codeVersion);
  try {
    return await evaluate(ctx);
  } catch (error) {
    if (!(error instanceof UpstreamNotReady)) throw error;
    return { status: "PARTIAL", reason: "UPSTREAM_NOT_READY", rowsWritten: 0, summary: { upstream_not_ready: 1 } };
  }
}

async function evaluate(ctx: JobContext): Promise<JobRunResult> {
  // analytics-start-date: the brief has no viewer to ask, so pre-launch is excluded unconditionally, same as detect/pulse.
  const openedOn = await ctx.repos.readOpenedOn();
  return runBriefDaily({
    orgId: ctx.orgId,
    runId: ctx.runId,
    attempt: ctx.attempt,
    codeVersion: ctx.codeVersion,
    date: dateOfPeriodKey(ctx.periodKey),
    openedOn,
    factsReady: (date) => ctx.repos.factsReadyFor(date),
    readFigures: (periods) => ctx.repos.readBriefFigures(periods),
    newId: randomUUID,
    now: () => new Date(),
    commit: (write) => ctx.commit((repos) => write({ writeInsight: (insight, options) => repos.writeInsight(insight, options) })),
  });
}
