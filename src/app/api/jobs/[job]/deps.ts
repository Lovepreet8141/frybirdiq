import "server-only";

import { randomUUID } from "node:crypto";
import { serverEnv } from "@/lib/env";
import type { HandleDeps } from "@/lib/jobs/handle";
import { HEAVY_JOB_NAMES } from "@/lib/jobs/registry";
import type { JobWriteRepos } from "@/lib/jobs/repos";
import { createJobRunStore } from "@/lib/repositories/iq-job-runs";

/**
 * Recorded as iq_job_runs.code_version when DEVOPS-RELEASE's deploy.sh has
 * not (yet) written DEPLOY_COMMIT to the environment — a dev shell, or a
 * deploy that predates it.
 */
export const JOB_CODE_VERSION_UNKNOWN = "unversioned";

/** Throws when the environment is invalid; the route turns that into an empty 404. */
export function jobRouteDeps(): HandleDeps<JobWriteRepos> {
  const env = serverEnv();
  const codeVersion = env.DEPLOY_COMMIT ?? JOB_CODE_VERSION_UNKNOWN;
  return {
    secrets: { current: env.JOB_SECRET, previous: env.JOB_SECRET_PREVIOUS },
    store: createJobRunStore({ codeVersion, heavyJobs: HEAVY_JOB_NAMES }),
    newLeaseOwner: randomUUID,
    monotonicMs: () => performance.now(),
    every: (ms, tick) => {
      const timer = setInterval(tick, ms);
      return () => clearInterval(timer);
    },
  };
}
