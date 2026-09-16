import { config } from "dotenv";

config({ path: ".env.test.local", quiet: true });

/**
 * The one guard that matters more than any test in this suite: refuse to
 * run at all unless DATABASE_URL is unambiguously a local address. Every
 * test file in this suite creates, mutates and deletes real rows — the
 * entire point is that it's safe to do that here. `.env.test.local` is
 * meant to always point at the local `supabase start` stack, but a config
 * file can be edited or copied wrong, and the cost of getting this specific
 * check wrong is real production data. Never soften this into a warning.
 */
const url = process.env.DATABASE_URL ?? "";
const isLocal = /^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
if (!isLocal) {
  throw new Error(
    `vitest.integration.setup: DATABASE_URL does not look like a local database ` +
      `(got "${url.replace(/:[^:@/]*@/, ":***@")}"). Refusing to run — this suite ` +
      `creates and deletes real rows and must never run against anything but the ` +
      `local \`supabase start\` stack. Run \`supabase start\` and check .env.test.local.`,
  );
}
