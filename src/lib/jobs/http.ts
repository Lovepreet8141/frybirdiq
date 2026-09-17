/**
 * The HTTP edge of the job runner: a web `Request` in, a `Response` out.
 *
 * The route file (src/app/api/jobs/[job]/route.ts) only resolves the `job`
 * segment and calls this; everything testable lives here.
 *
 * What the caller sees (DESIGN.md §3, DESIGN-v2-DELTA.md §3, SECURITY review):
 * - every refusal is an empty 404 — dormant runner, a request that came
 *   through nginx, a foreign Host, a wrong or missing secret, an unknown job,
 *   an oversized or unparseable body, and an environment that fails to load;
 * - a store failure before any work is an empty 500;
 * - otherwise 200 or 500 with the run report (job, periods, counts) as JSON.
 * No error text, header or body is ever logged or echoed.
 */
import { handleJobRequest, type HandleDeps } from "./handle";

/** The only body a job accepts is `{ "period": "…" }`; anything bigger is refused unread. */
export const MAX_JOB_BODY_BYTES = 1024;

const INVALID = Symbol("invalid body");

const empty = (status: 200 | 404 | 500) => new Response(null, { status, headers: { "cache-control": "no-store" } });

async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= MAX_JOB_BODY_BYTES)) return INVALID;
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JOB_BODY_BYTES) return INVALID;
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return INVALID;
  }
}

export async function respondToJobRequest<Tx>(request: Request, jobParam: string, makeDeps: () => HandleDeps<Tx>): Promise<Response> {
  let deps: HandleDeps<Tx>;
  try {
    // serverEnv() throws on a bad environment; its message must not reach the caller.
    deps = makeDeps();
  } catch {
    return empty(404);
  }

  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return empty(404);
  }
  if (body === INVALID) return empty(404);

  let result: Awaited<ReturnType<typeof handleJobRequest>>;
  try {
    result = await handleJobRequest({ jobParam, headers: request.headers, body }, deps);
  } catch {
    return empty(500);
  }

  if (result.status === 404) return empty(404);
  if (result.body === null) return empty(result.status);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
