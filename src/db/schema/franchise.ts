/**
 * Franchise partner inquiries, submitted from the public homepage's
 * franchise form. Deliberately minimal — this is a mailbox, not a CRM: no
 * status workflow, no assignment, no follow-up tracking. Add those only
 * when someone actually needs them.
 *
 * Never read or written through the Supabase client — no RLS policy grants
 * either role access (see supabase/migrations/0030_franchise_inquiries.sql,
 * same "no policy at all" pattern as idempotency_keys/webhook_events). The
 * one write path is a server action using this app's own `postgres`
 * connection, which bypasses RLS by design; there is no read path yet.
 */

import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { organizations } from "./tenancy";

export const franchiseInquiries = pgTable("franchise_inquiries", {
  id: primaryId(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  city: text("city").notNull(),
  phone: text("phone").notNull(),
  message: text("message").notNull().default(""),
  createdAt: timestamps.createdAt,
});
