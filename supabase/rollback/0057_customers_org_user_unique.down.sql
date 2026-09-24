-- Hand-run only. Reverses 0057. Safe at any time: dropping the constraint cannot lose data, only reopens
-- the pre-existing check-then-insert race in completeProfileAction (harmless-but-untidy duplicate rows, not
-- a cross-tenant or authorization issue).
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/rollback/0057_customers_org_user_unique.down.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_org_user_unique";
COMMIT;
