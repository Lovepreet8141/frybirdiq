ALTER TABLE "organizations" ADD COLUMN "cod_cap" bigint DEFAULT 150000 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "cash_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "online_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "opening_time" text DEFAULT '11:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "closing_time" text DEFAULT '23:00' NOT NULL;