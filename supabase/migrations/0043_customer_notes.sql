-- Customer notes (roadmap 7.1): staff-written free text on a customer, e.g.
-- "allergic to sesame", "prefers the corner table". Expand-only: one nullable
-- column, no default, no rewrite; the code before this ignores it.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_notes_length_check" CHECK ("notes" IS NULL OR char_length("notes") <= 1000);
