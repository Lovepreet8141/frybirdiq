/**
 * The job registry — the only jobs the runner will start.
 *
 * DESIGN.md §3 with DESIGN-v2-DELTA.md §3. The route answers 404 for any name
 * not listed here. Each job has its own systemd timer (DEVOPS-RELEASE);
 * `onCalendarUtc` is the timer's OnCalendar value, and a test keeps the two
 * in step once the unit files exist; null means the job has no timer and is
 * only ever started by hand.
 *
 * Heavy jobs: `heavyRunLive` is check-then-claim, so two different heavy jobs
 * starting together could both run. With one heavy job registered that
 * cannot happen; registering a second needs a lock first (RELIABILITY, s7b),
 * and a test holds that line. TODO: make iq-facts-backfill heavy once heavy
 * exclusion takes a lock (RELIABILITY iq1-s8r D).
 *
 * Heavy jobs stay off the backup window, 22:00–22:45 UTC (RELIABILITY S10
 * condition): a test checks that a heavy job's timer start plus every systemd
 * retry ends before 22:00 UTC.
 *
 * Timing, identical for every job in IQ-0:
 *   lease 300s  — another attempt may take over after this much silence
 *   heartbeat 60s — extends the lease while the job runs
 *   deadline 240s — the job commits its cursor and stops; curl's -m 290 and
 *                   Node's 300s requestTimeout are both above it
 *   maxAttempts 3 — matches systemd Restart=on-failure ×3
 */
import type { JobContext, JobRunResult } from "./context";
import { FACTS_NIGHTLY_JOB } from "./facts-plan";
import { BRIEF_JOB_NAME, runBrief } from "./jobs/brief";
import { runDetect } from "./jobs/detect";
import { runFactsBackfill, runFactsIntraday, runFactsNightly } from "./jobs/facts";
import { runIntradayBackfillJob } from "./jobs/intraday";
import { PULSE_JOB_NAME, runPulse } from "./jobs/pulse";
import { RECONCILE_JOB_NAME, runReconcile } from "./jobs/reconcile";
import { runHeartbeat } from "./jobs/heartbeat";
import { REFUND_HEAL_JOB, runRefundFollowUpHeal } from "./jobs/refund-heal";
import type { PeriodKind, PeriodTarget } from "./period";

export type JobConcurrency = "light" | "heavy";

export type JobDefinition = {
  readonly name: string;
  readonly periodKind: PeriodKind;
  readonly target: PeriodTarget;
  /** systemd OnCalendar, always in UTC (IST = UTC + 05:30); null for a job only started by hand. */
  readonly onCalendarUtc: string | null;
  readonly leaseSeconds: number;
  readonly heartbeatSeconds: number;
  readonly deadlineSeconds: number;
  readonly maxAttempts: number;
  /** Earlier periods a scheduled run also claims, oldest first. A 15-minute pulse uses 0. */
  readonly catchUpPeriods: number;
  /** Heavy jobs never run at the same time as each other. */
  readonly concurrency: JobConcurrency;
  run(ctx: JobContext): Promise<JobRunResult>;
};

export const DEFAULT_TIMING = {
  leaseSeconds: 300,
  heartbeatSeconds: 60,
  deadlineSeconds: 240,
  maxAttempts: 3,
} as const;

export const JOB_REGISTRY = {
  heartbeat: {
    name: "heartbeat",
    periodKind: "hour",
    target: "current",
    onCalendarUtc: "*-*-* *:00:00 UTC",
    ...DEFAULT_TIMING,
    catchUpPeriods: 0,
    concurrency: "light",
    run: runHeartbeat,
  },
  /** IQ-1 facts, 02:00 IST (20:30 UTC) for yesterday's period — clear of the 22:00 UTC backup with all retries. */
  [FACTS_NIGHTLY_JOB]: {
    name: FACTS_NIGHTLY_JOB,
    periodKind: "day",
    target: "previous",
    onCalendarUtc: "*-*-* 20:30:00 UTC",
    ...DEFAULT_TIMING,
    // Each night already covers the current and previous month.
    catchUpPeriods: 0,
    concurrency: "heavy",
    run: runFactsNightly,
  },
  /** IQ-1 facts and IQ-2 intraday buckets for today, every 15 minutes (IST quarters line up with UTC quarters). */
  "iq-facts-intraday": {
    name: "iq-facts-intraday",
    periodKind: "quarter_hour",
    target: "current",
    onCalendarUtc: "*-*-* *:00/15:00 UTC",
    ...DEFAULT_TIMING,
    catchUpPeriods: 0,
    concurrency: "light",
    run: runFactsIntraday,
  },
  /** IQ-1 facts history, started by hand with a period; resumable. */
  "iq-facts-backfill": {
    name: "iq-facts-backfill",
    periodKind: "day",
    target: "previous",
    onCalendarUtc: null,
    ...DEFAULT_TIMING,
    catchUpPeriods: 0,
    concurrency: "light",
    run: runFactsBackfill,
  },
  /**
   * IQ-2 baseline detectors for yesterday, 21:15 UTC (02:45 IST), after
   * nightly facts. Fails closed with UPSTREAM_NOT_READY until facts for the
   * day are final; catch-up 1 re-evaluates a night missed that way (R2.8, U1).
   * Its 60 s deadline keeps start + retries clear of 21:45–23:00 UTC.
   */
  "iq-detect-daily": {
    name: "iq-detect-daily",
    periodKind: "day",
    target: "previous",
    onCalendarUtc: "*-*-* 21:15:00 UTC",
    ...DEFAULT_TIMING,
    deadlineSeconds: 60,
    catchUpPeriods: 1,
    concurrency: "light",
    run: runDetect,
  },
  /** IQ-2 intraday buckets for the 8 weeks before the period's day, started by hand; resumable. */
  "iq-intraday-backfill": {
    name: "iq-intraday-backfill",
    periodKind: "day",
    target: "previous",
    onCalendarUtc: null,
    ...DEFAULT_TIMING,
    catchUpPeriods: 0,
    concurrency: "light",
    run: runIntradayBackfillJob,
  },
  /**
   * IQ-2 reconciliation for yesterday, 21:00 UTC (02:30 IST), after nightly
   * facts and before the detectors. Like detect it fails closed with
   * UPSTREAM_NOT_READY until the facts for the day are final, and catch-up 1
   * re-evaluates a night missed that way (R2.8).
   *
   * Deadline 180 s: each of the 8 rules reads in its own snapshot with a 10 s
   * statement timeout (RECON_STATEMENT_TIMEOUT_MS), so a run where every rule
   * times out still has room to write; start plus all systemd retries ends at
   * 21:32 UTC, clear of the 21:45 backup window.
   */
  [RECONCILE_JOB_NAME]: {
    name: RECONCILE_JOB_NAME,
    periodKind: "day",
    target: "previous",
    onCalendarUtc: "*-*-* 21:00:00 UTC",
    ...DEFAULT_TIMING,
    deadlineSeconds: 180,
    catchUpPeriods: 1,
    concurrency: "light",
    run: runReconcile,
  },
  /**
   * IQ-2 daily brief FACTs for yesterday, 02:00 UTC (07:30 IST) — before the
   * owner reads the brief, and hours after the night's facts, reconcile and
   * detect runs, so a night that needed its retries has finished. Facts gate,
   * no catch-up: the brief is about yesterday, and a day whose facts never
   * became final has nothing to cite. Deadline 30 s (S10): a handful of
   * summed reads and at most 7 FACT writes.
   */
  [BRIEF_JOB_NAME]: {
    name: BRIEF_JOB_NAME,
    periodKind: "day",
    target: "previous",
    onCalendarUtc: "*-*-* 02:00:00 UTC",
    ...DEFAULT_TIMING,
    deadlineSeconds: 30,
    catchUpPeriods: 0,
    concurrency: "light",
    run: runBrief,
  },
  /**
   * IQ-2 service pulse, every quarter at :05/:20/:35/:50 — five minutes after
   * the intraday writer's own quarter, so the bucket it evaluates is usually
   * already filled. When it is not, the run ends COMPLETE with `stale_input`
   * and the next quarter re-reads the same bucket, so there is no catch-up and
   * nothing to retry. Deadline 60 s: reads for 9 days and one order count.
   */
  [PULSE_JOB_NAME]: {
    name: PULSE_JOB_NAME,
    periodKind: "quarter_hour",
    target: "current",
    onCalendarUtc: "*-*-* *:05/15:00 UTC",
    ...DEFAULT_TIMING,
    deadlineSeconds: 60,
    catchUpPeriods: 0,
    concurrency: "light",
    run: runPulse,
  },
  // TODO(IQ-2 S7, AUTOMATION-ARCHITECT): register these when their bodies land (R2.1, R2.8):
  // - iq-money-signatures   (PAYMENT-SAFETY src/lib/iq/signatures/signatures-job.ts): hour/current, :10 hourly,
  //   light, catch-up 0, <= 15 s per org.
  /**
   * ref-b7: lost refund follow-ups, every 15 minutes at :07 (clear of the :00
   * quarter jobs), light, no catch-up — the next quarter picks up anything
   * missed, and the healer only takes follow-ups older than 5 minutes.
   */
  [REFUND_HEAL_JOB]: {
    name: REFUND_HEAL_JOB,
    periodKind: "quarter_hour",
    target: "current",
    onCalendarUtc: "*-*-* *:07/15:00 UTC",
    ...DEFAULT_TIMING,
    catchUpPeriods: 0,
    concurrency: "light",
    run: runRefundFollowUpHeal,
  },
} as const satisfies Record<string, JobDefinition>;

export type JobName = keyof typeof JOB_REGISTRY;

export const JOB_NAMES = Object.keys(JOB_REGISTRY) as JobName[];

export function isJobName(value: string): value is JobName {
  return Object.hasOwn(JOB_REGISTRY, value);
}

export function jobDefinition(name: JobName): JobDefinition {
  return JOB_REGISTRY[name];
}

/** Names of jobs that must never run at the same time as another heavy job. */
export function heavyJobNames(registry: Readonly<Record<string, JobDefinition>>): string[] {
  return Object.values(registry)
    .filter((job) => job.concurrency === "heavy")
    .map((job) => job.name);
}

export const HEAVY_JOB_NAMES: readonly string[] = heavyJobNames(JOB_REGISTRY);
