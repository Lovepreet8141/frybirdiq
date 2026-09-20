/**
 * iq-reconcile-nightly — thin adapter (IQ-2 R2.1) binding FINANCE-LEDGER's
 * body `runReconcileNightly` (src/lib/iq/reconcile/reconcile-job.ts) to the
 * job context. It mirrors `detect.ts`: nothing here decides anything.
 *
 * The period's IST day is the day evaluated (D-1, target previous); the rule
 * reads go through ctx.repos.readRecon, which runs each rule in its own
 * read-only snapshot with its own statement timeout, and the DETECTIONs and
 * the clear expiries go through one fenced chunk.
 *
 * The body throws UpstreamNotReady (code UPSTREAM_NOT_READY) while the facts
 * for the day are not final; the adapter turns it into PARTIAL reason
 * UPSTREAM_NOT_READY. The run answers 500 and writes nothing (fail closed),
 * but counts no failure, so however often systemd retries that night the next
 * night's catch-up can still take the period over (RELIABILITY iq2-s7).
 */
import { randomUUID } from "node:crypto";

import { RECONCILE_JOB_NAME, UpstreamNotReady, runReconcileNightly } from "@/lib/iq/reconcile/reconcile-job";

import type { JobContext, JobRunResult } from "../context";
import { dateOfPeriodKey } from "../facts-plan";
import { requireCodeVersion } from "./code-version";

/** The registry name and the `producedBy.job` of every insight it writes are one constant. */
export { RECONCILE_JOB_NAME, UpstreamNotReady };

export async function runReconcile(ctx: JobContext): Promise<JobRunResult> {
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
  return runReconcileNightly({
    orgId: ctx.orgId,
    runId: ctx.runId,
    attempt: ctx.attempt,
    codeVersion: ctx.codeVersion,
    date: dateOfPeriodKey(ctx.periodKey),
    factsReady: (date) => ctx.repos.factsReadyFor(date),
    readRecon: (date, now) => ctx.repos.readRecon(date, now),
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
