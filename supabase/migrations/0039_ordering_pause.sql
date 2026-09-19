-- The Close Shop switch (ops-1, S2): organizations.ordering_paused_at, _by,
-- _reason. Staff pause online ordering without touching the opening hours;
-- while paused, placeOrder refuses before any payment. Design:
-- hive/research/ops-1/DESIGN.md S2. Recovery: docs/MIGRATION-RECOVERY.md §4f
-- and supabase/rollback/0039_ordering_pause.down.sql.
--
-- Expand-only, safe to run before the deploy: three nullable columns, no
-- default, no backfill. Every existing org reads as "taking orders", and the
-- code already live never names these columns.
--
-- One CHECK: paused_at and paused_by are set together; the reason is null
-- whenever not paused (resuming clears it); a reason is 1-200 characters.
-- The DB is looser than the staff form (3-200, required) on purpose.
--
-- No RLS change: organizations_tenant_read (0033) lets members only read
-- their own org, so the reason and paused_by never reach a customer.
--
-- Journal `when` set by hand to 1790400000000, above 0038's 1790300000000.
--
-- organizations is read on every request. ADD COLUMN without a default is a
-- catalogue change, but it still waits for an ACCESS EXCLUSIVE lock: give up
-- after 5 s rather than queue the whole site behind a long transaction.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ordering_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ordering_paused_by" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ordering_paused_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ordering_pause_check" CHECK (("organizations"."ordering_paused_at" IS NULL) = ("organizations"."ordering_paused_by" IS NULL)
      AND ("organizations"."ordering_paused_at" IS NOT NULL OR "organizations"."ordering_paused_reason" IS NULL)
      AND ("organizations"."ordering_paused_reason" IS NULL OR char_length("organizations"."ordering_paused_reason") BETWEEN 1 AND 200));