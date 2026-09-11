-- Rewrites the stamp card into FRYBIRD REWARDS: one universal card, a
-- proper ledger, a real reward-unlock/redemption lifecycle, and configurable
-- rules (spend threshold, stamp goal, free-item cap) instead of the earlier
-- "buy 7 get the 8th free, cheapest item auto-discounted" version shipped in
-- 0014. Nothing here touches points, which are unrelated and unchanged.
--
-- Written by hand, like 0013 and 0014's follow-up: several of these column
-- changes are semantic, not simple renames (stamp_reward_goal=8 meant "the
-- 8th order is free"; stamps_required=7 means "7 stamps unlocks it" — the
-- same fact, a different number), so this is drop-and-add with an explicit
-- backfill rather than a bare rename, and drizzle-kit's interactive
-- rename-or-recreate prompts have no TTY to answer them in this session
-- anyway.
--
-- There is real (test) data in loyalty_stamp_events and loyalty_accounts on
-- the connected database as of this migration — verified before writing
-- this, four accounts and one stamp event, all from this session's own
-- smoke-testing. The backfill below carries it forward rather than
-- discarding it.

CREATE TYPE "public"."loyalty_reward_status" AS ENUM('AVAILABLE', 'REDEEMED', 'REVERSED');--> statement-breakpoint

CREATE TABLE "loyalty_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"status" "loyalty_reward_status" DEFAULT 'AVAILABLE' NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_order_id" uuid,
	"redeemed_product_slug" text,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_rewards_account_idx" ON "loyalty_rewards" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "loyalty_rewards_account_status_idx" ON "loyalty_rewards" USING btree ("account_id","status");--> statement-breakpoint

-- organizations: the stamp card's rules, now configurable from FRYBIRD IQ.
ALTER TABLE "organizations" ADD COLUMN "stamps_required" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stamp_min_order_value" bigint DEFAULT 20000 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stamp_max_reward_value" bigint DEFAULT 25000 NOT NULL;--> statement-breakpoint
-- Carry the old goal forward rather than resetting everyone to the new
-- default: goal=8 meant "7 stamps, the 8th free" — the same fact 7 states
-- directly. Ordering matters: this reads stamp_reward_goal before it is dropped.
UPDATE "organizations" SET "stamps_required" = GREATEST("stamp_reward_goal" - 1, 1);--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "stamp_reward_goal";--> statement-breakpoint

-- orders: which reward (if any) this order redeemed, not just whether one was applied.
ALTER TABLE "orders" ADD COLUMN "stamp_reward_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stamp_reward_product_slug" text;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "stamp_reward_applied";--> statement-breakpoint

-- loyalty_stamp_events: from a bare counter-with-a-kind to a real ledger —
-- one row per order that ever earned a stamp (order_id now required and
-- unique, the idempotency guarantee itself), which reward it was consumed
-- into, and whether it was later reversed by a refund.
ALTER TABLE "loyalty_stamp_events" ADD COLUMN "reward_id" uuid;--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" ADD CONSTRAINT "loyalty_stamp_events_reward_id_loyalty_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."loyalty_rewards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" DROP COLUMN "count_after";--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_stamp_events" ADD CONSTRAINT "loyalty_stamp_events_order_unique" UNIQUE("order_id");--> statement-breakpoint

DROP TYPE "public"."loyalty_stamp_event_kind";
