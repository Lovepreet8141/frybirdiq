-- Hand-run only. Reverses 0038: restores 0034's iq_insights read policy and
-- freeze function, then drops the constraints and the five columns.
--
-- Loses each insight's copy, trust metric ids and reasons, as_of and
-- status_reason. Insights are derived; the jobs rewrite them. Deploy code that
-- no longer reads or writes these columns first (src/lib/repositories/
-- iq-insights.ts writes them after 0038).
--
-- Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0038_iq_insights_copy_trust.down.sql
-- then delete the 0038 row from drizzle.__drizzle_migrations (production:
-- created_at = 1790200000000), or version '0038' from
-- supabase_migrations.schema_migrations on a CLI-managed local stack.
-- That delete is outside this transaction; 0038 must be the newest applied
-- migration, or Drizzle will never re-apply it.

BEGIN;

DROP POLICY IF EXISTS iq_insights_staff_read ON iq_insights;
CREATE POLICY iq_insights_staff_read ON iq_insights
  FOR SELECT TO authenticated
  USING (auth_has_role(org_id, ARRAY['OWNER', 'ADMIN', 'MANAGER']));

-- 0034's body, verbatim.
CREATE OR REPLACE FUNCTION public.iq_insights_freeze_referenced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.referenced_at IS NOT NULL AND (
       NEW.referenced_at IS DISTINCT FROM OLD.referenced_at
    OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.claim_type IS DISTINCT FROM OLD.claim_type
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.subject_kind IS DISTINCT FROM OLD.subject_kind
    OR NEW.subject_ref IS DISTINCT FROM OLD.subject_ref
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
    OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.evidence IS DISTINCT FROM OLD.evidence
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
  ) THEN
    RAISE EXCEPTION 'iq_insights %: referenced insights are frozen; supersede with a new row', OLD.id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "iq_insights" DROP CONSTRAINT IF EXISTS "iq_insights_ledger_producer_check";
ALTER TABLE "iq_insights" DROP CONSTRAINT IF EXISTS "iq_insights_status_reason_check";
ALTER TABLE "iq_insights" DROP CONSTRAINT IF EXISTS "iq_insights_trust_detail_check";
ALTER TABLE "iq_insights" DROP CONSTRAINT IF EXISTS "iq_insights_copy_check";
ALTER TABLE "iq_insights"
  DROP COLUMN IF EXISTS "status_reason",
  DROP COLUMN IF EXISTS "as_of",
  DROP COLUMN IF EXISTS "copy",
  DROP COLUMN IF EXISTS "trust_reasons",
  DROP COLUMN IF EXISTS "trust_metric_ids";

COMMIT;
