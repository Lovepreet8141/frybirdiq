/**
 * The job registry — the only jobs the runner will start.
 *
 * DESIGN.md §3 with DESIGN-v2-DELTA.md §3. The route answers 404 for any name
 * not listed here. Each job has its own systemd timer (DEVOPS-RELEASE);
 * `onCalendarUtc` is the timer's OnCalendar value, and a test keeps the two
 * in step once the unit files exist.
 *
 * Timing, identical for every job in IQ-0:
 *   lease 300s  — another attempt may take over after this much silence
 *   heartbeat 60s — extends the lease while the job runs
 *   deadline 240s — the job commits its cursor and stops; curl's -m 290 and
 *                   Node's 300s requestTimeout are both above it
 *   maxAttempts 3 — matches systemd Restart=on-failure ×3
 */
import type { JobContext, JobRunResult } from "./context";
import { runHeartbeat } from "./jobs/heartbeat";
import type { PeriodKind, PeriodTarget } from "./period";

export type JobConcurrency = "light" | "heavy";

export type JobDefinition = {
  readonly name: string;
  readonly periodKind: PeriodKind;
  readonly target: PeriodTarget;
  /** systemd OnCalendar, always in UTC; IST = UTC + 05:30. */
  readonly onCalendarUtc: string;
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
