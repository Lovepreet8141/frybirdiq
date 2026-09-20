-- Hand-run only. Reverses PENDING_shift_breaks: drops the shift_breaks table.
-- REFUSES while any break row exists (they are the record of recorded break
-- times): export (COPY shift_breaks TO ...) and delete deliberately first.
-- The code-only rollback needs none of this: the older build ignores the table.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM shift_breaks) THEN
    RAISE EXCEPTION 'shift_breaks has rows; export and delete them deliberately first';
  END IF;
END $$;
DROP TABLE "shift_breaks";
COMMIT;
