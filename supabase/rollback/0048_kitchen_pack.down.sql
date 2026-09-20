-- Hand-run only. Reverses 0048_kitchen_pack: drops kitchen_order_pack. Loses only
-- which takeaway/delivery orders were packed, and by whom. Orders are untouched.
-- Run BEFORE 0047_kitchen_stations.down.sql if both are being rolled back.
BEGIN;
DROP TABLE IF EXISTS "kitchen_order_pack";
COMMIT;
