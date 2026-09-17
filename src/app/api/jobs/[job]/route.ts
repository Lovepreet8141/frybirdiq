import { respondToJobRequest } from "@/lib/jobs/http";
import { jobRouteDeps } from "./deps";

/**
 * POST /api/jobs/<job> — started by a systemd timer on the same machine.
 *
 * Thin by design: authentication, claims, leases and responses all live in
 * src/lib/jobs (http.ts → handle.ts). The proxy does not run for this path
 * (src/proxy.ts matcher) and nginx answers 404 for it from outside (S10), so
 * a public GET reaching the app would get Next's 405, telling the two apart.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ job: string }> }): Promise<Response> {
  const { job } = await context.params;
  return respondToJobRequest(request, job, jobRouteDeps);
}
