-- Hand-run only. Reverses 0045_shifts: drops the shifts table.
-- REFUSES while any shift row exists: those rows are the record of who worked
-- when. Export them first (COPY shifts TO ...), then delete the rows and run
-- this. The code-only rollback needs none of this: the older build ignores the table.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM shifts) THEN
    RAISE EXCEPTION 'shifts has rows; export and delete them deliberately first';
  END IF;
END $$;
DROP TABLE "shifts";
COMMIT;
