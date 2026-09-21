-- Rider limits editable in Admin (card `rider-limits-admin`): the most deliveries one rider may hold at once and the most
-- they may take in a rolling hour, per organization. Defaults are the accepted figures (2 and 6), so every existing row
-- behaves exactly as before. CHECKs bound both (1-5 and 1-20): taking reveals a customer's details, so the take cap
-- cannot be switched off even by a hand edit. Recovery: docs/MIGRATION-RECOVERY.md 4m and
-- supabase/rollback/0054_rider_limits.down.sql.
--
-- Additive and safe before the deploy: two NOT NULL smallint columns with constant defaults (no table rewrite) and two
-- CHECKs validated over the existing rows (all default). The code already live never names the columns.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rider_max_active" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rider_max_takes_per_hour" smallint DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_rider_max_active_check" CHECK ("organizations"."rider_max_active" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_rider_max_takes_per_hour_check" CHECK ("organizations"."rider_max_takes_per_hour" BETWEEN 1 AND 20);
