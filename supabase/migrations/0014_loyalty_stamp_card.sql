-- The stamp card: "buy 7, get the 8th free." A second, independent loyalty
-- mechanic alongside points — visit-based rather than value-based, one stamp
-- per qualifying order regardless of what it cost. loyalty_accounts carries
-- the running count, same as pointsBalance; loyalty_stamp_events is its
-- ledger, same reason loyalty_transactions exists for points — a balance
-- nobody can explain is a balance a customer will dispute. orders carries
-- whether *that* order redeemed the reward, so a later change to the goal
-- can never rewrite what an old order actually gave away.

CREATE TYPE "public"."loyalty_stamp_event_kind" AS ENUM('EARNED', 'REDEEMED');--> statement-breakpoint
CREATE TABLE "loyalty_stamp_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "loyalty_stamp_event_kind" NOT NULL,
	"count_after" integer NOT NULL,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stamp_reward_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stamp_reward_goal" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD COLUMN "stamp_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stamp_reward_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stamp_reward_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" ADD CONSTRAINT "loyalty_stamp_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" ADD CONSTRAINT "loyalty_stamp_events_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_stamp_events_account_idx" ON "loyalty_stamp_events" USING btree ("account_id");