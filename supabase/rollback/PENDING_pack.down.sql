-- Hand-run only. Reverses PENDING_pack: drops kitchen_order_pack. Loses only
-- which takeaway/delivery orders were packed, and by whom. Orders are untouched.
-- Run BEFORE PENDING_stations.down.sql if both are being rolled back.
BEGIN;
DROP TABLE IF EXISTS "kitchen_order_pack";
COMMIT;
