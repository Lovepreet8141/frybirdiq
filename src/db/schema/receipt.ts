/** The receipt designer's storage: one row per organization, three templates. */

import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { organizations } from "./tenancy";

/**
 * Draft is what the owner is editing; active is what the POS prints;
 * previous is the active design before the last apply, kept so a bad
 * design can be undone in one click. Templates are configuration only
 * (`src/lib/receipt/template.ts`) — no order data ever lives here.
 */
export const receiptDesigns = pgTable("receipt_designs", {
  id: primaryId(),
  orgId: uuid("org_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  draft: jsonb("draft").$type<Record<string, unknown>>().notNull(),
  active: jsonb("active").$type<Record<string, unknown>>(),
  previous: jsonb("previous").$type<Record<string, unknown>>(),
  draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }),
  draftUpdatedBy: uuid("draft_updated_by"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  appliedBy: uuid("applied_by"),
  ...timestamps,
});
