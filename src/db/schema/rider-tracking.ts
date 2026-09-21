/**
 * Rider live position. Migration: 0056_rider_positions.
 *
 * One row per GPS fix a rider's browser posts while a delivery is out (about every 15 seconds). Rows exist only to show
 * the customer where their rider is right now, so they are deleted after 24 hours (the `rider-positions-purge` job).
 * Coordinates are integer microdegrees like every other coordinate here. Nothing on the client side can read this table:
 * the app reads it through Drizzle after checking who is asking (`repositories/rider-tracking.ts`).
 */

import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryId } from "./_shared";
import { orders } from "./orders";
import { organizations } from "./tenancy";

export const riderPositions = pgTable(
  "rider_positions",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Auth user id of the rider who posted it. Loose: a staff record leaving must not break history. */
    riderUserId: uuid("rider_user_id").notNull(),
    latMicro: integer("lat_micro").notNull(),
    lngMicro: integer("lng_micro").notNull(),
    /** Reported accuracy in metres, when the device says. */
    accuracyMetres: integer("accuracy_metres"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("rider_positions_order_recorded_idx").on(table.orderId, table.recordedAt),
    index("rider_positions_recorded_idx").on(table.recordedAt),
    check("rider_positions_lat_check", sql`${table.latMicro} BETWEEN -90000000 AND 90000000`),
    check("rider_positions_lng_check", sql`${table.lngMicro} BETWEEN -180000000 AND 180000000`),
    check("rider_positions_accuracy_check", sql`${table.accuracyMetres} IS NULL OR ${table.accuracyMetres} >= 0`),
  ],
);
