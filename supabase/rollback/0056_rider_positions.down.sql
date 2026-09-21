-- Hand-run only. Reverses the rider live position migration (0056). Loses the position rows, which are at most 24 hours old and only ever
-- served the customer's live map; nothing else reads them. One transaction.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/rollback/0056_rider_positions.down.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS "rider_positions";
COMMIT;
