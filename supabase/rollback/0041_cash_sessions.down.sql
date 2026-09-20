-- Hand-run only. Reverses 0041 (the till: cash sessions and rider handovers):
-- one transaction, and it REFUSES while any cash session or handover exists.
--
-- Why refuse: those rows are the record of what the till held, what was
-- counted, who was short and which rider handed over what. Dropping the tables
-- deletes that history for good, and nothing else in the books can rebuild it.
-- Export them first (COPY ... TO), decide deliberately, then delete the rows
-- and run this. The code-only rollback needs none of this: the previous build
-- ignores the tables and the payments columns.
--
-- Loses: cash_sessions, cash_handovers, and payments.cash_session_id /
-- collected_by / held_by_rider / handover_id (which payment was in which
-- session, who took each cash payment, which rider cash was handed over). The
-- payments themselves, and their amounts, are untouched.
--
-- Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0041_cash_sessions.down.sql
-- then delete the 0041 row from drizzle.__drizzle_migrations (production:
-- created_at = 1790600000000), or version '0041' from
-- supabase_migrations.schema_migrations on a CLI-managed local stack. That
-- delete is outside this transaction; 0041 must be the newest applied
-- migration, or Drizzle will never re-apply it.
--
-- Statement order: lock timeout -> lock -> guard -> constraints/indexes ->
-- columns -> tables.

BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "payments" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  sessions integer;
  handovers integer;
BEGIN
  SELECT count(*) INTO sessions FROM cash_sessions;
  SELECT count(*) INTO handovers FROM cash_handovers;
  IF sessions > 0 OR handovers > 0 THEN
    RAISE EXCEPTION '0041 down refused: % cash session(s) and % handover(s) exist; they are the till''s history. Export them and delete them deliberately first.', sessions, handovers
      USING ERRCODE = '55000';
  END IF;
END $$;

ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_cash_holder_check";
DROP INDEX IF EXISTS "payments_cash_session_idx";
DROP INDEX IF EXISTS "payments_rider_unhanded_idx";
ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "handover_id",
  DROP COLUMN IF EXISTS "held_by_rider",
  DROP COLUMN IF EXISTS "collected_by",
  DROP COLUMN IF EXISTS "cash_session_id";
DROP TABLE IF EXISTS "cash_handovers";
DROP TABLE IF EXISTS "cash_sessions";

COMMIT;
