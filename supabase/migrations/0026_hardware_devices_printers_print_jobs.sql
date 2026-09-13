CREATE TABLE "pos_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"name" text NOT NULL,
	"device_type" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text,
	"printer_bridge_version" text,
	"hardware_capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_printer_status" text,
	"last_printer_check_at" timestamp with time zone,
	"registered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_devices_type_check" CHECK ("pos_devices"."device_type" IN ('DESKTOP', 'TABLET', 'PHONE', 'POS_TERMINAL')),
	CONSTRAINT "pos_devices_platform_check" CHECK ("pos_devices"."platform" IN ('WEB', 'ANDROID', 'IOS', 'WINDOWS', 'MACOS', 'LINUX'))
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"device_id" uuid,
	"printer_id" uuid,
	"order_id" uuid,
	"receipt_design_id" uuid,
	"kind" text DEFAULT 'RECEIPT' NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"requested_by" uuid,
	"printed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_jobs_status_check" CHECK ("print_jobs"."status" IN ('QUEUED', 'PRINTING', 'PRINTED', 'FAILED')),
	CONSTRAINT "print_jobs_kind_check" CHECK ("print_jobs"."kind" IN ('RECEIPT', 'DUPLICATE', 'TEST'))
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"manufacturer" text,
	"connection_type" text DEFAULT 'LAN' NOT NULL,
	"ip_address" text,
	"port" integer DEFAULT 9100 NOT NULL,
	"mac_address" text,
	"bluetooth_identifier" text,
	"paper_width_mm" integer DEFAULT 80 NOT NULL,
	"protocol" text DEFAULT 'ESC/POS' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"auto_print_enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_successful_print_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printers_connection_check" CHECK ("printers"."connection_type" IN ('LAN', 'BLUETOOTH', 'USB')),
	CONSTRAINT "printers_port_check" CHECK ("printers"."port" BETWEEN 1 AND 65535),
	CONSTRAINT "printers_paper_check" CHECK ("printers"."paper_width_mm" IN (58, 80)),
	CONSTRAINT "printers_status_check" CHECK ("printers"."last_status" IN ('ONLINE', 'OFFLINE', 'CONNECTING', 'ERROR', 'UNKNOWN', 'UNAVAILABLE'))
);
--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_receipt_design_id_receipt_designs_id_fk" FOREIGN KEY ("receipt_design_id") REFERENCES "public"."receipt_designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_device_id_pos_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."pos_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_org_key_unique" ON "pos_devices" USING btree ("org_id","device_key");--> statement-breakpoint
CREATE INDEX "pos_devices_location_idx" ON "pos_devices" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "print_jobs_order_idx" ON "print_jobs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "print_jobs_org_created_idx" ON "print_jobs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "print_jobs_order_receipt_unique" ON "print_jobs" USING btree ("order_id") WHERE "print_jobs"."kind" = 'RECEIPT';--> statement-breakpoint
CREATE INDEX "printers_org_idx" ON "printers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "printers_device_idx" ON "printers" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "printers_location_default_unique" ON "printers" USING btree ("location_id") WHERE "printers"."is_default" = true AND "printers"."is_active" = true;--> statement-breakpoint
-- Same tenant policy as every other org-scoped table. See 0001.
ALTER TABLE "pos_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pos_devices_tenant_isolation ON pos_devices
  FOR ALL TO authenticated
  USING (org_id IN (SELECT auth_org_ids()))
  WITH CHECK (org_id IN (SELECT auth_org_ids()));--> statement-breakpoint
ALTER TABLE "printers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "printers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY printers_tenant_isolation ON printers
  FOR ALL TO authenticated
  USING (org_id IN (SELECT auth_org_ids()))
  WITH CHECK (org_id IN (SELECT auth_org_ids()));--> statement-breakpoint
ALTER TABLE "print_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "print_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY print_jobs_tenant_isolation ON print_jobs
  FOR ALL TO authenticated
  USING (org_id IN (SELECT auth_org_ids()))
  WITH CHECK (org_id IN (SELECT auth_org_ids()));
