-- Hand-run only. Reverses 0034: drops the seven iq_* tables, their triggers,
-- policies and grants (all go with the tables), and the two trigger functions.
--
-- Loses every row in them: job runs, insights, forecasts, recommendations,
-- actions (including approvals and undo records), outcomes and auto
-- policies. Safe only while those hold nothing that cannot be regenerated —
-- see docs/MIGRATION-RECOVERY.md §4a before running it anywhere but locally.
-- Deploy code that no longer reads iq_* first.
--
-- One transaction: either all of 0034 is gone or none of it is. Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0034_iq_foundations.down.sql
-- then delete the 0034 row from drizzle.__drizzle_migrations (production:
-- the row with created_at = 1789800000000), or version '0034' from
-- supabase_migrations.schema_migrations on a CLI-managed local stack.
-- 0034 must be the newest applied migration, or Drizzle will never re-apply it.

BEGIN;

-- Children before parents; CASCADE is deliberately not used, so an unexpected
-- dependency from a later migration stops the rollback instead of silently
-- dropping it.
DROP TABLE IF EXISTS "iq_actions";
DROP TABLE IF EXISTS "iq_auto_policies";
DROP TABLE IF EXISTS "iq_outcomes";
DROP TABLE IF EXISTS "iq_recommendations";
DROP TABLE IF EXISTS "iq_forecasts";
DROP TABLE IF EXISTS "iq_insights";
DROP TABLE IF EXISTS "iq_job_runs";

DROP FUNCTION IF EXISTS public.iq_recommendations_reference_insights();
DROP FUNCTION IF EXISTS public.iq_insights_freeze_referenced();

COMMIT;
