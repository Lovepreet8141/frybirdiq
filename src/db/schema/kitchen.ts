/**
 * Kitchen stations (roadmap 4.2). Migrations: PENDING_stations, PENDING_station_tasks.
 *
 * Which station a line belongs to is resolved live (override, category,
 * combo components: `src/lib/kitchen/stations.ts`). This table only records
 * that a station finished a task. One row per (order item, station) — a combo
 * line has several; presence means done, deleting the row is "undo".
 */

import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId } from "./_shared";
import { orderItems, orders } from "./orders";
import { organizations } from "./tenancy";

export const kitchenLineStatus = pgTable(
  "kitchen_line_status",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    /** The station the line resolved to when it was marked. */
    station: text("station").notNull(),
    /** Auth user id. Loose: a staff record leaving must not break history. */
    doneBy: uuid("done_by"),
    doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("kitchen_line_status_item_station_idx").on(table.orderItemId, table.station),
    index("kitchen_line_status_org_order_idx").on(table.orgId, table.orderId),
    check("kitchen_line_status_station_check", sql`${table.station} IN ('FRY', 'ASSEMBLY', 'DRINKS', 'PACK', 'UNASSIGNED')`),
  ],
);

/**
 * The PACK step (roadmap 4.2). Migration: PENDING_pack.
 *
 * One row per TAKEAWAY or DELIVERY order once it has been packed. Presence
 * means packed; deleting the row is "undo".
 */
export const kitchenOrderPack = pgTable(
  "kitchen_order_pack",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Auth user id. Loose, like `done_by`. */
    packedBy: uuid("packed_by"),
    packedAt: timestamp("packed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("kitchen_order_pack_order_idx").on(table.orderId), index("kitchen_order_pack_org_idx").on(table.orgId)],
);
