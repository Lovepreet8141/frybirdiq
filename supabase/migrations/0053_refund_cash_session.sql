-- Cash refunds belong to the till that paid them (till go-live checklist:
-- `cash-refund-attribution` and `till-close-micros`). refunds.cash_session_id records the open till at the moment a
-- CASH refund is finalized (read FOR SHARE, the same lock the till's close takes), so a till's expected cash counts
-- exactly the refunds attributed to it, with no comparison of timestamps. A refund paid while no till is open is in
-- no till (null), never guessed from a time window. Recovery: docs/MIGRATION-RECOVERY.md 4l and
-- supabase/rollback/0053_refund_cash_session.down.sql.
--
-- Additive and safe before the deploy: one nullable column, an index and a CHECK on refunds. The code already live never
-- names the column, and every existing refund reads as "in no till". Production has no cash refunds yet (the till has not
-- been used), so nothing needs backfilling; the CHECK is validated over the existing rows in the same transaction (all
-- have a null cash_session_id).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "cash_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cash_session_only_cash" CHECK (("refunds"."cash_session_id" IS NULL OR "refunds"."provider" = 'cash'));
--> statement-breakpoint
CREATE INDEX "refunds_cash_session_idx" ON "refunds" USING btree ("cash_session_id") WHERE "refunds"."cash_session_id" IS NOT NULL;
