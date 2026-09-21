-- Hand-run only. Reverses 0054 (rider limits editable in Admin): one transaction.
--
-- Loses: any limits an owner set (organizations.rider_max_active, rider_max_takes_per_hour). After the undo, the previous
-- code (which uses the constants 2 and 6) works exactly as before. Export first if the values matter:
--   COPY (SELECT id, rider_max_active, rider_max_takes_per_hour FROM organizations) TO STDOUT WITH CSV HEADER;
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_rider_max_takes_per_hour_check";
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_rider_max_active_check";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "rider_max_takes_per_hour";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "rider_max_active";
COMMIT;
