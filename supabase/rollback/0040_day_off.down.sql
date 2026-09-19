-- Hand-run only. Reverses 0040 (ops-3, day off and planned closures): one
-- transaction, and it REFUSES while a closure could still be holding customers
-- back: a weekly closed day is set, or a closed date has not yet passed.
--
-- Why refuse: the code before 0040 has no idea closures exist. Drop them while
-- Tuesday is marked and the shop silently OPENS to orders on Tuesday. Clear
-- the weekly closed days and delete upcoming closed dates deliberately first
-- (Admin -> Restaurant, or psql), then run this. The code-only rollback needs
-- none of this: the older build ignores the columns, and Tuesday orders would
-- then be accepted, which is why the runbook says to switch ordering off by
-- hand for the days concerned before rolling back the code.
--
-- Loses: the weekly closed days and every closed date (the audit rows for each
-- change stay in audit_logs).
--
-- Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0040_day_off.down.sql
-- then delete the 0040 row from drizzle.__drizzle_migrations (production:
-- created_at = 1790500000000), or version '0040' from
-- supabase_migrations.schema_migrations on a CLI-managed local stack. That
-- delete is outside this transaction; 0040 must be the newest applied
-- migration, or Drizzle will never re-apply it.
--
-- Statement order: lock timeout -> lock -> guard -> table -> constraint -> column.

BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "organizations" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  weekly text;
  upcoming integer;
BEGIN
  SELECT string_agg(slug || ' (' || weekly_closed_days::text || ')', ', ' ORDER BY slug)
  INTO weekly
  FROM organizations
  WHERE cardinality(weekly_closed_days) > 0;
  IF weekly IS NOT NULL THEN
    RAISE EXCEPTION '0040 down refused: clear the weekly closed days first, or the shop silently opens on them: %', weekly
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO upcoming
  FROM closed_dates
  WHERE end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date;
  IF upcoming > 0 THEN
    RAISE EXCEPTION '0040 down refused: % closed date(s) have not passed yet; delete them first, or the shop silently opens on them', upcoming
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP TABLE IF EXISTS "closed_dates";
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_weekly_closed_days_check";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "weekly_closed_days";

COMMIT;
