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
import { runDetect } from "./jobs/detect";
import { runFactsBackfill, runFactsIntraday, runFactsNightly } from "./jobs/facts";
import { runIntradayBackfillJob } from "./jobs/intraday";
import { runHeartbeat } from "./jobs/heartbeat";
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
  // TODO(IQ-2 S7, AUTOMATION-ARCHITECT): register these when their bodies land (R2.1, R2.8):
  // - iq-reconcile-nightly  (FINANCE-LEDGER src/lib/iq/reconcile/reconcile-job.ts): day/previous, 21:00 UTC,
  //   light, catch-up 1, facts-ready gate -> UPSTREAM_NOT_READY, statement 10 s per rule.
  // - iq-money-signatures   (PAYMENT-SAFETY src/lib/iq/signatures/signatures-job.ts): hour/current, :10 hourly,
  //   light, catch-up 0, <= 15 s per org.
  // - iq-service-pulse      (IQ-ENGINE src/lib/iq/detect/pulse-job.ts, S9): quarter_hour, :05/:20/:35/:50,
  //   light, catch-up 0; fresh-input rule C8/U3 needs an intraday-writer-run port.
  // - iq-brief-daily        (BUSINESS-INTELLIGENCE src/lib/iq/brief/brief-job.ts, S10): day/previous, 02:00 UTC,
  //   facts-ready gate, catch-up 0, <= 30 s.
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
