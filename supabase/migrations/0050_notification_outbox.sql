-- Roadmap 7.2: the WhatsApp order-update outbox. One new empty table, additive,
-- safe before the deploy: nothing reads it until the service is wired to an
-- order status change. Same RLS posture as closed_dates (0040): forced, no
-- client DML, members may read their own org's rows; the app writes as
-- `postgres` through Drizzle. Unnumbered: the integrator numbers it and adds
-- the journal entry. Down file: supabase/rollback/0050_notification_outbox.down.sql
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"channel" text DEFAULT 'WHATSAPP' NOT NULL,
	"to_status" "order_status" NOT NULL,
	"template" text NOT NULL,
	"to_phone" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_outbox_once_key" UNIQUE("org_id","order_id","channel","to_status"),
	CONSTRAINT "notification_outbox_status_check" CHECK ("notification_outbox"."status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
	CONSTRAINT "notification_outbox_sent_check" CHECK (("notification_outbox"."status" = 'SENT') = ("notification_outbox"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("org_id","created_at") WHERE "notification_outbox"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "notification_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "notification_outbox" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE POLICY notification_outbox_tenant_read ON "notification_outbox" FOR SELECT TO authenticated
  USING (org_id IN (SELECT auth_org_ids()));--> statement-breakpoint
GRANT SELECT ON TABLE "notification_outbox" TO authenticated;
