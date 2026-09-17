import "server-only";

import { randomUUID } from "node:crypto";
import { serverEnv } from "@/lib/env";
import type { HandleDeps } from "@/lib/jobs/handle";
import { JOB_REGISTRY, type JobDefinition } from "@/lib/jobs/registry";
import { createJobRunStore, type JobTx } from "@/lib/repositories/iq-job-runs";

/**
 * What the job route runs with in production.
 *
 * Recorded as iq_job_runs.code_version. There is no environment variable for
 * the deployed commit yet (src/lib/env is BACKEND's); until there is, every
 * run records this constant.
 */
export const JOB_CODE_VERSION = "unversioned";

const HEAVY_JOBS = (Object.values(JOB_REGISTRY) as JobDefinition[])
  .filter((job) => job.concurrency === "heavy")
  .map((job) => job.name);

/** Throws when the environment is invalid; the route turns that into an empty 404. */
export function jobRouteDeps(): HandleDeps<JobTx> {
  const env = serverEnv();
  return {
    secrets: { current: env.JOB_SECRET, previous: env.JOB_SECRET_PREVIOUS },
    store: createJobRunStore({ codeVersion: JOB_CODE_VERSION, heavyJobs: HEAVY_JOBS }),
    newLeaseOwner: randomUUID,
    monotonicMs: () => performance.now(),
    every: (ms, tick) => {
      const timer = setInterval(tick, ms);
      return () => clearInterval(timer);
    },
  };
}
