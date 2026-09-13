-- Hand-run only. Reverses 0025: drops the receipt designer's storage.
-- Every saved receipt design (draft, active and previous) is lost and the
-- POS prints the built-in default again. After running this, delete the
-- 0025 row from drizzle.__drizzle_migrations.
DROP TABLE IF EXISTS "receipt_designs";
