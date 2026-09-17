-- Refund reservations: refunds.status (RESERVED | SUCCEEDED | FAILED),
-- idempotency_key with UNIQUE (org_id, idempotency_key) (NULLs distinct), and
-- finalized_at, set exactly when a refund is SUCCEEDED. Slice 1 of
-- hive/agents/michael-mu4lr1ro/reports/2026-09-16-refund-design.md
-- (Revision 2), card ref-b1, owner decision dec-10 (local build). Recovery:
-- docs/MIGRATION-RECOVERY.md §4e and
-- supabase/rollback/0038_refunds_status_idempotency.down.sql.
--
-- Existing rows: every one is SUCCEEDED. The only refunds insert in src/ and
-- scripts/ (payments.ts) runs after the provider confirmed the refund, cash
-- refunds succeed by construction, and production has no Razorpay refunds
-- (design §4). No row is left unclassified; amounts do not change.
--
-- Number 0038 (next free after 0037; the design's "0036" was taken). Journal
-- `when` set by hand to 1790300000000, above 0037's 1790200000000.
-- status: added with DEFAULT 'SUCCEEDED' only so existing rows get it (design
-- S3), then the default is dropped: new code must always write status.
ALTER TABLE "refunds" ADD COLUMN "status" text DEFAULT 'SUCCEEDED' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
-- Existing rows completed synchronously: created_at is when the money left
-- (design S6). Must run before refunds_finalized_check below.
UPDATE "refunds" SET "finalized_at" = "created_at" WHERE "finalized_at" IS NULL;--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_reserved_idx" ON "refunds" USING btree ("org_id","created_at") WHERE "refunds"."status" = 'RESERVED';--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_idempotency_unique" UNIQUE("org_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" IN ('RESERVED', 'SUCCEEDED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_finalized_check" CHECK (("refunds"."status" = 'SUCCEEDED') = ("refunds"."finalized_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_idempotency_key_check" CHECK ("refunds"."idempotency_key" IS NULL OR char_length("refunds"."idempotency_key") BETWEEN 1 AND 200);
