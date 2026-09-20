/**
 * Basic shifts (roadmap 6.4): who clocked in, and when they clocked out.
 * Migration PENDING_shifts.
 *
 * One row per stretch of work for one person. A row with no `clock_out_at` is an
 * open shift, and a partial unique index allows at most one open shift per
 * person per org, so a double-tapped Clock in cannot open two. No wages, no
 * breaks and no overtime live here: hours are clock-out minus clock-in.
 *
 * `business_date` is the IST calendar day of the clock-in (a shift that runs
 * past midnight belongs to the day it started). `user_id` is the auth user id,
 * loose like the till's, so a staff record leaving does not break history.
 */

import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId } from "./_shared";
import { organizations } from "./tenancy";

export const SHIFT_NOTE_MAX = 200;

export const shifts = pgTable(
  "shifts",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    clockInAt: timestamp("clock_in_at", { withTimezone: true }).notNull().defaultNow(),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    /** Set when a manager corrected the times; the audit row holds before and after. */
    correctedBy: uuid("corrected_by"),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shifts_one_open_per_person_idx").on(table.orgId, table.userId).where(sql`${table.clockOutAt} IS NULL`),
    index("shifts_org_date_idx").on(table.orgId, table.businessDate),
    check("shifts_order_check", sql`${table.clockOutAt} IS NULL OR ${table.clockOutAt} > ${table.clockInAt}`),
    check("shifts_note_check", sql`${table.note} IS NULL OR char_length(${table.note}) BETWEEN 1 AND ${sql.raw(String(SHIFT_NOTE_MAX))}`),
  ],
);
