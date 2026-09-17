-- IQ-2 S1: iq_insights carries what present() needs and what the
-- expire-on-clear guard needs. Requires 0034. Number 0038 because the refund
-- release holds 0037 (whichever merges second renumbers; iq.test.ts checks
-- journal `when` order). hive reviews/iq-2 DESIGN.md S1 + Revision 2 (R2.2,
-- R2.3, R2.11); schema in src/db/schema/iq.ts. Recovery:
-- docs/MIGRATION-RECOVERY.md §4d and
-- supabase/rollback/0038_iq_insights_copy_trust.down.sql.
--
-- - copy jsonb NOT NULL, placeholder default {"templateId":"none","slots":{}}
--   for existing rows (production holds none, dec-2); strict shape CHECK.
-- - trust_metric_ids / trust_reasons text[] with TrustRefSchema CHECKs.
-- - as_of timestamptz NOT NULL, no default; existing rows take period_end.
-- - status_reason, tied to the status it explains.
-- - dedupe_key 'recon:'/'sig:' tied to producer 'recon.'/'sig.' (ARCH P3).
-- Hand-written at the end: the 0034 freeze function now covers copy, and the
-- iq_insights read policy hides recon./sig. findings from ADMIN.
--
-- Journal `when` set by hand to 1790200000000 (0036 is 1790000000000; 0037's
-- slot is left for the refund release).

-- Existing MEASURED or INSUFFICIENT_DATA rows cannot be given the metric ids
-- or reasons the new CHECK requires. They are derived: delete them and let
-- the jobs rewrite them, then run this migration. Production has none (dec-2).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM iq_insights WHERE trust_state <> 'NOT_MEASURED') THEN
    RAISE EXCEPTION '0038: iq_insights has MEASURED or INSUFFICIENT_DATA rows without trust detail; delete them (derived, the jobs rewrite them) and run 0038 again (docs/MIGRATION-RECOVERY.md 4d)'
      USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "iq_insights" ADD COLUMN "trust_metric_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "iq_insights" ADD COLUMN "trust_reasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "iq_insights" ADD COLUMN "copy" jsonb DEFAULT '{"templateId":"none","slots":{}}'::jsonb NOT NULL;--> statement-breakpoint
-- as_of has no default (RELIABILITY U2). Existing rows take their period end,
-- which is what the column means; then it becomes NOT NULL.
ALTER TABLE "iq_insights" ADD COLUMN "as_of" timestamp with time zone;--> statement-breakpoint
UPDATE "iq_insights" SET "as_of" = "period_end";--> statement-breakpoint
ALTER TABLE "iq_insights" ALTER COLUMN "as_of" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "iq_insights" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "iq_insights" ADD CONSTRAINT "iq_insights_copy_check" CHECK (CASE WHEN jsonb_typeof("iq_insights"."copy") = 'object'
            AND ("iq_insights"."copy" - 'templateId' - 'slots') = '{}'::jsonb
            AND jsonb_typeof("iq_insights"."copy" -> 'templateId') = 'string'
            AND jsonb_typeof("iq_insights"."copy" -> 'slots') = 'object'
          THEN ("iq_insights"."copy" ->> 'templateId') ~ '^[a-z0-9][a-z0-9_.:-]*$'
            AND char_length("iq_insights"."copy" ->> 'templateId') <= 120
            AND NOT jsonb_path_exists("iq_insights"."copy" -> 'slots', '$.keyvalue() ? (!(@.key like_regex "^[a-z0-9][a-z0-9_.:-]*$"))')
            AND NOT jsonb_path_exists("iq_insights"."copy" -> 'slots', '$.* ? (@.type() != "string")')
            AND NOT jsonb_path_exists("iq_insights"."copy" -> 'slots', '$.* ? (!(@ like_regex "^[A-Za-z0-9_]+([.][A-Za-z0-9_]+)*$"))')
          ELSE false END);--> statement-breakpoint
ALTER TABLE "iq_insights" ADD CONSTRAINT "iq_insights_trust_detail_check" CHECK (array_position("iq_insights"."trust_metric_ids", NULL) IS NULL
          AND array_position("iq_insights"."trust_reasons", NULL) IS NULL
          AND cardinality("iq_insights"."trust_metric_ids") <= 50
          AND cardinality("iq_insights"."trust_reasons") <= 50
          AND (array_to_string("iq_insights"."trust_metric_ids", ',') ~ '^([a-z0-9][a-z0-9_.:-]*(,[a-z0-9][a-z0-9_.:-]*)*)?$'
            AND length(array_to_string("iq_insights"."trust_metric_ids", ',')) - length(replace(array_to_string("iq_insights"."trust_metric_ids", ','), ',', '')) = greatest(cardinality("iq_insights"."trust_metric_ids") - 1, 0)
            AND (array_to_string("iq_insights"."trust_metric_ids", ',') = '') = (cardinality("iq_insights"."trust_metric_ids") = 0))
          AND (array_to_string("iq_insights"."trust_reasons", ',') ~ '^([A-Z][A-Z0-9_]*(,[A-Z][A-Z0-9_]*)*)?$'
            AND length(array_to_string("iq_insights"."trust_reasons", ',')) - length(replace(array_to_string("iq_insights"."trust_reasons", ','), ',', '')) = greatest(cardinality("iq_insights"."trust_reasons") - 1, 0)
            AND (array_to_string("iq_insights"."trust_reasons", ',') = '') = (cardinality("iq_insights"."trust_reasons") = 0))
          AND CASE "iq_insights"."trust_state"
            WHEN 'MEASURED' THEN cardinality("iq_insights"."trust_metric_ids") >= 1
            WHEN 'INSUFFICIENT_DATA' THEN cardinality("iq_insights"."trust_reasons") >= 1 AND cardinality("iq_insights"."trust_metric_ids") = 0
            ELSE cardinality("iq_insights"."trust_metric_ids") = 0 AND cardinality("iq_insights"."trust_reasons") = 0
          END);--> statement-breakpoint
ALTER TABLE "iq_insights" ADD CONSTRAINT "iq_insights_status_reason_check" CHECK ("iq_insights"."status_reason" IS NULL
          OR ("iq_insights"."status_reason" IN ('CLEARED', 'CLOSING_TIME', 'SUPERSEDED', 'RETRACTED') AND CASE "iq_insights"."status_reason"
            WHEN 'SUPERSEDED' THEN "iq_insights"."status" = 'SUPERSEDED'
            WHEN 'RETRACTED' THEN "iq_insights"."status" = 'RETRACTED'
            ELSE "iq_insights"."status" = 'EXPIRED'
          END));--> statement-breakpoint
ALTER TABLE "iq_insights" ADD CONSTRAINT "iq_insights_ledger_producer_check" CHECK (("iq_insights"."dedupe_key" LIKE 'recon:%') = ("iq_insights"."producer" LIKE 'recon.%')
          AND ("iq_insights"."dedupe_key" LIKE 'sig:%') = ("iq_insights"."producer" LIKE 'sig.%'));

--> statement-breakpoint
-- The wording a decision rests on is frozen with the claim (ARCH R3c). Trust,
-- as_of, status, status_reason, superseded_by and expires_at stay writable.
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
    OR NEW.copy IS DISTINCT FROM OLD.copy
  ) THEN
    RAISE EXCEPTION 'iq_insights %: referenced insights are frozen; supersede with a new row', OLD.id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Defence in depth for R2.2: reconciliation (recon.*) and payment-signature
-- (sig.*) findings are payment-ledger data, readable with a Supabase key by
-- OWNER and MANAGER only (finance.view). ADMIN keeps every other insight, as
-- in 0034. The app reads as postgres and gates these in its loader.
DROP POLICY iq_insights_staff_read ON iq_insights;
--> statement-breakpoint
CREATE POLICY iq_insights_staff_read ON iq_insights
  FOR SELECT TO authenticated
  USING (
    auth_has_role(org_id, ARRAY['OWNER', 'MANAGER'])
    OR (
      auth_has_role(org_id, ARRAY['ADMIN'])
      AND producer NOT LIKE 'recon.%'
      AND producer NOT LIKE 'sig.%'
    )
  );
