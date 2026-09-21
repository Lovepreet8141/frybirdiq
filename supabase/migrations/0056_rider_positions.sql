-- Lane B: rider live position. One new empty table, additive, safe before the deploy: nothing writes to it until the rider
-- screen posts fixes. Same posture as notification_outbox (0050) but stricter: RLS forced, ALL privileges revoked from every client role and NO
-- client policy at all, so nothing can read or write it through PostgREST or Realtime; the app reads and writes as `postgres` through Drizzle after
-- checking who is asking. Rows are deleted after 24 hours by the `rider-positions-purge` job. Undo: supabase/rollback/0056_rider_positions.down.sql
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "rider_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"rider_user_id" uuid NOT NULL,
	"lat_micro" integer NOT NULL,
	"lng_micro" integer NOT NULL,
	"accuracy_metres" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rider_positions_lat_check" CHECK ("rider_positions"."lat_micro" BETWEEN -90000000 AND 90000000),
	CONSTRAINT "rider_positions_lng_check" CHECK ("rider_positions"."lng_micro" BETWEEN -180000000 AND 180000000),
	CONSTRAINT "rider_positions_accuracy_check" CHECK ("rider_positions"."accuracy_metres" IS NULL OR "rider_positions"."accuracy_metres" >= 0)
);
--> statement-breakpoint
ALTER TABLE "rider_positions" ADD CONSTRAINT "rider_positions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_positions" ADD CONSTRAINT "rider_positions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rider_positions_order_recorded_idx" ON "rider_positions" USING btree ("order_id","recorded_at");--> statement-breakpoint
CREATE INDEX "rider_positions_recorded_idx" ON "rider_positions" USING btree ("recorded_at");--> statement-breakpoint
ALTER TABLE "rider_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rider_positions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "rider_positions" FROM PUBLIC, anon, authenticated;
