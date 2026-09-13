-- Hand-run only. Reverses 0026: drops the POS device, printer and print job
-- tables. Every registered device, printer configuration and print history
-- is lost; the POS falls back to browser printing. After running this,
-- delete the 0026 row from drizzle.__drizzle_migrations.
DROP TABLE IF EXISTS "print_jobs";
DROP TABLE IF EXISTS "printers";
DROP TABLE IF EXISTS "pos_devices";
