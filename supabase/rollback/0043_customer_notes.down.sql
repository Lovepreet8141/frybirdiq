-- Hand-run only. Reverses 0043_customer_notes: drops customers.notes.
-- Loses every note staff have written on a customer; export first
-- (COPY (SELECT id, notes FROM customers WHERE notes IS NOT NULL) TO ...).
-- The code-only rollback needs none of this: the older build ignores the column.
BEGIN;
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_notes_length_check";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "notes";
COMMIT;
