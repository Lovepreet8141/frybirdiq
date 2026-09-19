-- The Close Shop switch (ops-1, S2): organizations.ordering_paused_at, _by,
-- _reason, _until. Staff pause online ordering without touching the opening
-- hours; while paused, placeOrder refuses before any payment. _until is the
-- owner's "how long": "until we next open" (default) sets it, "until I switch
-- it back on" leaves it null. A pause past its _until no longer counts; nothing
-- writes at that instant. Design:
-- hive/research/ops-1/DESIGN.md S2. Recovery: docs/MIGRATION-RECOVERY.md §4f
-- and supabase/rollback/0039_ordering_pause.down.sql.
--
-- Expand-only, safe to run before the deploy: four nullable columns, no
-- default, no backfill. Every existing org reads as "taking orders", and the
-- code already live never names these columns.
--
-- One CHECK: paused_at and paused_by are set together (every pause has a
-- person behind it; an automatic pause would need this CHECK changed first);
-- the reason and _until are null whenever not paused (resuming clears them);
-- a reason is 1-200 characters (the staff form requires 3-200); _until is
-- after paused_at.
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
ALTER TABLE "organizations" ADD COLUMN "ordering_paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ordering_pause_check" CHECK (("organizations"."ordering_paused_at" IS NULL) = ("organizations"."ordering_paused_by" IS NULL)
      AND ("organizations"."ordering_paused_at" IS NOT NULL OR "organizations"."ordering_paused_reason" IS NULL)
      AND ("organizations"."ordering_paused_reason" IS NULL OR char_length("organizations"."ordering_paused_reason") BETWEEN 1 AND 200)
      AND ("organizations"."ordering_paused_until" IS NULL OR ("organizations"."ordering_paused_at" IS NOT NULL AND "organizations"."ordering_paused_until" > "organizations"."ordering_paused_at")));