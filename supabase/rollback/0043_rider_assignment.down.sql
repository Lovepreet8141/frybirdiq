-- Hand-run only. Reverses 0043 (rider assignment): one transaction.
--
-- Loses: which rider each delivery was assigned to (orders.rider_id) and when
-- (rider_assigned_at). Orders, their statuses, payments and events are untouched.
-- The rider ROLE and the deliveries themselves are unaffected. If deliveries are
-- in flight, riders lose the "my deliveries" scoping until the code is rolled
-- back too (the previous build shows every rider every delivery, as before).
-- Export first if the assignments matter:
--   COPY (SELECT id, order_number, rider_id, rider_assigned_at FROM orders WHERE rider_id IS NOT NULL) TO STDOUT WITH CSV HEADER;
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP INDEX IF EXISTS "orders_rider_idx";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_rider_only_when_delivery";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "rider_assigned_at";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "rider_id";
COMMIT;
