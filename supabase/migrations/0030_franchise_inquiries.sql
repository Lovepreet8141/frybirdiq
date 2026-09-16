CREATE TABLE "franchise_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"phone" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "franchise_inquiries" ADD CONSTRAINT "franchise_inquiries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Written only by the server action behind the public franchise form, using
-- this app's own postgres connection, which bypasses RLS by design. Enabled
-- with no policy at all, same as idempotency_keys/webhook_events, so an anon
-- or authenticated Supabase client key sees and can write nothing — there is
-- no staff-facing read path for this table yet, and none should be assumed.
ALTER TABLE "franchise_inquiries" ENABLE ROW LEVEL SECURITY;