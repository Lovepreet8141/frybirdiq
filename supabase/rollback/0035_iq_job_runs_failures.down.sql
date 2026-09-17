-- Hand-run only. Reverses 0035: drops iq_job_runs.failures and its CHECK.
--
-- Loses the failure count of every job run; `attempt` and status remain, so
-- a run near its failure limit gets fresh retries. Deploy code that no longer
-- reads `failures` first (src/lib/jobs at d19f296 reads it).
--
-- Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0035_iq_job_runs_failures.down.sql
-- then delete the 0035 row from drizzle.__drizzle_migrations (production:
-- created_at = 1789900000000), or version '0035' from
-- supabase_migrations.schema_migrations on a CLI-managed local stack.
-- That delete is outside this transaction; 0035 must be the newest applied
-- migration, or Drizzle will never re-apply it.

BEGIN;

ALTER TABLE "iq_job_runs" DROP CONSTRAINT IF EXISTS "iq_job_runs_failures_check";
ALTER TABLE "iq_job_runs" DROP COLUMN IF EXISTS "failures";

COMMIT;
