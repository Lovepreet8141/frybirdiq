-- Order numbers restart each day; uniqueness must too.
--
-- The constraint was (org_id, order_number) across all time, while the
-- generator reset the number daily. The first order of the second day was
-- therefore guaranteed to collide, and checkout failed for every customer
-- with "duplicate key value violates unique constraint".
--
-- Written by hand rather than generated: a NOT NULL column on a table with
-- rows needs the backfill to happen between the ADD and the SET NOT NULL, and
-- the old constraint has to go before the new one can be satisfied.

ALTER TABLE "orders" ADD COLUMN "business_date" date;--> statement-breakpoint

-- Backfill from the timestamp, converted to IST. An order placed at 02:00 IST
-- belongs to the day that started the previous evening, which is exactly what
-- the timezone conversion gives and what UTC would not.
UPDATE "orders"
SET "business_date" = ("created_at" AT TIME ZONE 'Asia/Kolkata')::date
WHERE "business_date" IS NULL;--> statement-breakpoint

ALTER TABLE "orders" ALTER COLUMN "business_date" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_org_number_unique";--> statement-breakpoint

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_org_day_number_unique"
  UNIQUE ("org_id", "business_date", "order_number");--> statement-breakpoint

-- The counter and the dashboard both read "today's orders"; this is the index
-- that makes that a lookup rather than a scan.
CREATE INDEX IF NOT EXISTS "orders_org_business_date_idx"
  ON "orders" USING btree ("org_id", "business_date");
