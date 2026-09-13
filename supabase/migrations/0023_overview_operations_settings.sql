ALTER TABLE "organizations" ADD COLUMN "kitchen_capacity" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "opened_on" date;