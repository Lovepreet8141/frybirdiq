-- Hand-run only. Reverses 0038 (refund design Revision 2, S2): one
-- transaction, refunds locked, and it REFUSES while any refund is not
-- SUCCEEDED — it never deletes one.
--
-- Why refuse: a RESERVED row can be money that already moved (gateway accepted,
-- crash before finalize), and the pre-0038 code sums every refunds row as
-- money returned. Keeping or deleting RESERVED/FAILED rows both misstate the
-- books. Resolve each first (design §4): reconcile RESERVED rows against the
-- provider or the staff member on the audit row and finalize them; FAILED rows
-- need an explicit human decision to archive. Otherwise fix forward.
--
-- Loses: every refund's idempotency key and finalized_at (finance dates
-- refunds by it after slice 5). Deploy code that no longer writes these
-- columns first.
--
-- Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0038_refunds_status_idempotency.down.sql
-- then delete the 0038 row from drizzle.__drizzle_migrations (production:
-- created_at = 1790300000000), or version '0038' from
-- supabase_migrations.schema_migrations on a CLI-managed local stack.
-- That delete is outside this transaction; 0038 must be the newest applied
-- migration, or Drizzle will never re-apply it.
--
-- Statement order: lock timeout → lock → guard → indexes → constraints → columns.

BEGIN;

-- Give up after 5 s rather than queue every refund, payment page and
-- checkout behind this lock while a long transaction holds refunds.
SET LOCAL lock_timeout = '5s';
LOCK TABLE "refunds" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  unresolved text;
BEGIN
  SELECT string_agg(id::text || ' (' || status || ')', ', ' ORDER BY created_at)
  INTO unresolved
  FROM refunds
  WHERE status <> 'SUCCEEDED';
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION '0038 down refused: refunds not SUCCEEDED must be reconciled first: %', unresolved
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP INDEX IF EXISTS "refunds_reserved_idx";
DROP INDEX IF EXISTS "refunds_payment_idx";
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "refunds_org_idempotency_unique";
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "refunds_idempotency_key_check";
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "refunds_finalized_check";
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "refunds_status_check";
ALTER TABLE "refunds"
  DROP COLUMN IF EXISTS "finalized_at",
  DROP COLUMN IF EXISTS "idempotency_key",
  DROP COLUMN IF EXISTS "status";

COMMIT;
