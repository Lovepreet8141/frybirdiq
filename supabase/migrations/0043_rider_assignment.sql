-- Rider assignment (roadmap 6.3): which rider carries a delivery. Two nullable
-- columns on orders (rider_id, rider_assigned_at), an index for "my deliveries",
-- and a check that only a DELIVERY order can have a rider. Recovery:
-- docs/MIGRATION-RECOVERY.md 4j and supabase/rollback/0043_rider_assignment.down.sql.
--
-- Additive and safe before the deploy: the code already live never names the
-- columns; existing orders read as "no rider assigned", which is what they are.
-- ADD COLUMN with no default is catalogue-only; the CHECK is validated over the
-- existing rows (about a hundred) in the same transaction, and every existing
-- row satisfies it (rider_id is null).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rider_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rider_assigned_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_rider_only_when_delivery" CHECK (("orders"."rider_id" IS NULL OR "orders"."fulfilment" = 'DELIVERY'));
--> statement-breakpoint
CREATE INDEX "orders_rider_idx" ON "orders" USING btree ("org_id","rider_id") WHERE "orders"."rider_id" IS NOT NULL;
