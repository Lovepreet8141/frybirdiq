/**
 * Dine-in tables. BUILD-PLAN.md §22.
 *
 * `orders.table_label` already exists as a free-text column, but nothing in
 * the app ever writes it — there is no real table entity behind it, no
 * status, no capacity, just a column nobody populates. This is the real
 * thing it was standing in for: a table has an identity or it doesn't exist,
 * and "occupied" is answered by whether a live order references it, not by a
 * status this table stores and could drift from the orders that actually
 * define it.
 */

import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { locations, organizations } from "./tenancy";
import { primaryId, timestamps } from "./_shared";

export const tables = pgTable(
  "tables",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** e.g. "Patio", "Indoor" — the shop's own floor-plan vocabulary, not an enum. */
    category: text("category"),
    capacity: integer("capacity"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("tables_org_idx").on(table.orgId),
    index("tables_location_idx").on(table.locationId),
  ],
);
