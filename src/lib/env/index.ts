/**
 * Environment configuration. BUILD-PLAN.md §3, §46.
 *
 * Validated with Zod, split hard along the server/client line. The service
 * role key and the database URL are read through `serverEnv()`, which throws
 * if it is ever reached from a browser bundle — §46: "Never expose
 * service-role/database credentials in the browser."
 *
 * Validation is lazy rather than module-level on purpose. During Phase 0 there
 * is no Supabase project yet, and an eager `parse()` at import time would make
 * `next build` fail on a shell that has nothing to connect to. Instead, each
 * accessor throws where it is used, naming the variable that is missing.
 */

import { z } from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

/**
 * An optional secret.
 *
 * A variable that is present but empty means "not set". `.env.example` ships
 * every later-phase key blank, so a bare `.optional()` would never apply —
 * the key exists, the value is "", and the length check fails. Anyone copying
 * the template would be told their Razorpay keys were malformed before
 * Razorpay was even part of the build.
 */
const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

/**
 * Printable ASCII, no whitespace: `!` (0x21) through `~` (0x7e).
 *
 * `src/lib/jobs/auth.ts` compares the bearer token to this secret as raw
 * bytes. Whitespace or a non-ASCII character makes the secret impossible to
 * ever present correctly in an `Authorization: Bearer <token>` header (a
 * space ends the token; non-ASCII round-trips differently depending on how
 * it was typed and saved) — the runner would fail closed forever, silently,
 * with every request 404ing and no signal pointing at the env file. Reject
 * it here instead, at startup, where the message names the variable.
 */
const SECRET_CHARSET = /^[\x21-\x7e]+$/;

/**
 * An optional bearer secret: minimum length, and printable-ASCII-only once
 * set. Used for `JOB_SECRET` / `JOB_SECRET_PREVIOUS` — see `SECRET_CHARSET`.
 */
const optionalBearerSecret = (minLength: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .min(minLength)
      .regex(SECRET_CHARSET, "must not contain whitespace or non-ASCII characters")
      .optional(),
  );

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /**
   * Where this site lives, for links that leave it.
   *
   * Deliberately not NEXT_PUBLIC_: Next inlines those at build time, so one
   * set on the server would never reach a build made on a laptop — and the
   * link in every WhatsApp message would quietly stay localhost.
   */
  SITE_URL: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: optionalSecret,
  RAZORPAY_KEY_ID: optionalSecret,
  RAZORPAY_KEY_SECRET: optionalSecret,
  RAZORPAY_WEBHOOK_SECRET: optionalSecret,
  /**
   * Paytm (docs/PAYTM-PROVIDER.md). All unset means the provider is not
   * configured and fails closed. `PAYTM_ENV` must be exactly "staging" or
   * "production": there is no default, so a forgotten value can never send
   * test traffic to the live gateway or the reverse. Read only by
   * `paytmConfig()` in `src/lib/payments/paytm.ts`.
   */
  PAYTM_MID: optionalSecret,
  PAYTM_MERCHANT_KEY: optionalSecret,
  PAYTM_WEBSITE_NAME: optionalSecret,
  PAYTM_ENV: z.preprocess((value) => (value === "" ? undefined : value), z.enum(["staging", "production"]).optional()),
  PAYTM_CALLBACK_URL: optionalSecret,
  /** Only the exact string "true" opts in. Lets staging credentials run on the production deployment, for the sandbox proof only. Off by default. */
  PAYTM_ALLOW_STAGING: optionalSecret,
  /**
   * Bearer secret for `/api/jobs/[job]`. Unset means the job runner is
   * dormant — every job route 404s rather than running unauthenticated.
   * `JOB_SECRET_PREVIOUS` accepts the outgoing secret during rotation so a
   * deploy can roll the systemd credential without a window where in-flight
   * timers fail.
   */
  JOB_SECRET: optionalBearerSecret(32),
  JOB_SECRET_PREVIOUS: optionalBearerSecret(32),
});

/**
 * The deployed commit, written into `iq_job_runs.code_version` and every
 * insight's `producedBy.codeVersion` (`src/app/api/jobs/[job]/deps.ts`).
 *
 * Validated outside `serverSchema` on purpose: this is informational, not a
 * secret or a permission. `JOB_SECRET` fails closed because a bad value
 * would otherwise silently open (or wrongly deny) a security boundary — an
 * empty 404 either way, so refusing to boot is not a bigger outage than the
 * broken state. DEPLOY_COMMIT gates nothing; a malformed value should never
 * be able to take the whole app down. Unset (or invalid) means
 * `"unversioned"` at the call site, with a warning that never prints the
 * value, so a `git rev-parse` producing the wrong shape is visible without
 * being able to crash the process.
 */
const DEPLOY_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function readDeployCommit(): string | undefined {
  const raw = process.env.DEPLOY_COMMIT;
  if (raw === undefined || raw === "") return undefined;
  if (DEPLOY_COMMIT_PATTERN.test(raw)) return raw;
  console.warn(
    'env: DEPLOY_COMMIT is set but is not a 40-character lowercase git commit SHA — ignoring it; code_version will read "unversioned"',
  );
  return undefined;
}

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema> & { readonly DEPLOY_COMMIT: string | undefined };

function describe(error: z.ZodError): string {
  return error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
}

/**
 * Whether Supabase is wired up.
 *
 * Lets a page render an honest "not connected yet" state instead of crashing,
 * which is what §56 asks for — every feature needs an empty and an error state,
 * not just a happy path.
 */
export function isSupabaseConfigured(): boolean {
  return clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }).success;
}

export function clientEnv(): ClientEnv {
  // Destructured literally, not indexed dynamically: Next inlines
  // NEXT_PUBLIC_* by static analysis and `process.env[name]` would not be
  // replaced at build time.
  const result = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!result.success) {
    throw new Error(
      `Missing public environment variables. Copy .env.example to .env.local and fill these in:\n${describe(result.error)}`,
    );
  }
  return result.data;
}

export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("env: serverEnv() was reached from the browser — this would leak the service role key");
  }

  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Missing server environment variables. Copy .env.example to .env.local and fill these in:\n${describe(result.error)}`,
    );
  }
  return { ...result.data, DEPLOY_COMMIT: readDeployCommit() };
}
