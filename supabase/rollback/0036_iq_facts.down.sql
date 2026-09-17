-- Hand-run only. Reverses 0036: drops iq_daily_facts, iq_intraday_facts and
-- iq_daily_trust (their policies and grants go with them) and the three
-- read-path indexes on orders, payments and inventory_movements.
--
-- Loses every stored fact and trust grade. They are derived: the fact jobs
-- recompute them from orders, payments, refunds, movements and expenses, so
-- nothing is lost that a recompute cannot rebuild — except the record of what
-- a past report showed before a restatement. Dropping the indexes loses no
-- data. Deploy code that no longer reads iq_*_facts / iq_daily_trust first.
--
-- Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0036_iq_facts.down.sql
-- then delete the 0036 row from drizzle.__drizzle_migrations (production:
-- created_at = 1790000000000), or version '0036' from
-- supabase_migrations.schema_migrations on a CLI-managed local stack.
-- That delete is outside this transaction; 0036 must be the newest applied
-- migration, or Drizzle will never re-apply it.

BEGIN;

DROP TABLE IF EXISTS "iq_intraday_facts";
DROP TABLE IF EXISTS "iq_daily_facts";
DROP TABLE IF EXISTS "iq_daily_trust";

DROP INDEX IF EXISTS "inventory_movements_org_type_occurred_idx";
DROP INDEX IF EXISTS "payments_order_captured_idx";
DROP INDEX IF EXISTS "orders_org_created_idx";

COMMIT;
