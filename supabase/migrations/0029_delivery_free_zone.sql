ALTER TABLE "locations" ADD COLUMN "delivery_free_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "delivery_free_max_metres" integer;