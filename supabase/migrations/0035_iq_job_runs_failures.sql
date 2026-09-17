-- iq_job_runs.failures: failed attempts, counted apart from `attempt` (the
-- fencing generation). Required by src/lib/jobs (d19f296) and RELIABILITY
-- J3: a takeover or closeZombie adds one; a deadline cut with progress does
-- not. Additive: existing rows get 0. 0034 is merged, so it is not edited.
-- Recovery: docs/MIGRATION-RECOVERY.md §4b and
-- supabase/rollback/0035_iq_job_runs_failures.down.sql.
--
-- Journal `when` set by hand to 1789900000000 (above 0034's 1789800000000);
-- drizzle-kit's wall-clock stamp would be skipped by `db:migrate`.
ALTER TABLE "iq_job_runs" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "iq_job_runs" ADD CONSTRAINT "iq_job_runs_failures_check" CHECK ("iq_job_runs"."failures" >= 0);
