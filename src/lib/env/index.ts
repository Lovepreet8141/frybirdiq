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

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

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
  return result.data;
}
