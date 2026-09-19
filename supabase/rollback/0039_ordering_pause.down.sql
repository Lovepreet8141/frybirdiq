-- Hand-run only. Reverses 0039 (ops-1 S2, the Close Shop switch): one
-- transaction, and it REFUSES while any organization is paused.
--
-- Why refuse: the code before 0039 has no idea a pause exists. Drop the
-- columns while a shop is paused and that shop silently REOPENS: customers
-- can order again, and nobody is told. Resume ordering first (the staff
-- switch, or deliberately from a psql session), then run this.
--
-- Loses: only the current pause state (when, who, why). The audit rows for
-- each pause and resume stay in audit_logs.
--
-- Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0039_ordering_pause.down.sql
-- then delete the 0039 row from drizzle.__drizzle_migrations (production:
-- created_at = 1790400000000), or version '0039' from
-- supabase_migrations.schema_migrations on a CLI-managed local stack.
-- That delete is outside this transaction; 0039 must be the newest applied
-- migration, or Drizzle will never re-apply it.
--
-- Statement order: lock timeout → lock → guard → constraint → columns.

BEGIN;

-- organizations is read on every request: give up after 5 s rather than
-- queue the whole site behind this lock.
SET LOCAL lock_timeout = '5s';
LOCK TABLE "organizations" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  paused text;
BEGIN
  SELECT string_agg(slug || ' (paused since ' || ordering_paused_at::text || ')', ', ' ORDER BY slug)
  INTO paused
  FROM organizations
  WHERE ordering_paused_at IS NOT NULL;
  IF paused IS NOT NULL THEN
    RAISE EXCEPTION '0039 down refused: resume ordering first, or the shop silently reopens: %', paused
      USING ERRCODE = '55000';
  END IF;
END $$;

ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_ordering_pause_check";
ALTER TABLE "organizations"
  DROP COLUMN IF EXISTS "ordering_paused_reason",
  DROP COLUMN IF EXISTS "ordering_paused_by",
  DROP COLUMN IF EXISTS "ordering_paused_at";

COMMIT;
