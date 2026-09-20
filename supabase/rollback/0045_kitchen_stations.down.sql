-- Hand-run only. Reverses the 0045_kitchen_stations migration (kitchen stations):
-- drops kitchen_line_status. Loses only which station lines were marked done,
-- and by whom; orders, order items and product station settings are untouched.
-- The code-only rollback needs none of this: the previous build ignores the table.
--
-- Run with
--   psql -v ON_ERROR_STOP=1 -f supabase/rollback/0045_kitchen_stations.down.sql
-- then delete the migration's row from the migrations table (see 0041's down file).
BEGIN;
DROP TABLE IF EXISTS "kitchen_line_status";
COMMIT;
