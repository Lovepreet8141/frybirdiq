ALTER TABLE "orders" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoiced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_invoice_unique" UNIQUE("org_id","invoice_number");