/**
 * Planned closures (ops-3): a date or a run of dates the shop will not open,
 * with an optional note the customer sees ("Closed for Diwali"). Migration 0040.
 *
 * Dates are business dates (Asia/Kolkata calendar days) — a `date`, never a
 * timestamp — and `end_date` is inclusive, so a single day has start = end.
 * The weekly off day is not here: it is `organizations.weekly_closed_days`.
 *
 * Written only through Drizzle as `postgres` (the Admin actions); a Supabase
 * key can read a member's own org and nothing else. The note is public: it goes
 * on the website banner as plain text, so it is length-capped here and never
 * markup.
 */

import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { CLOSED_DATE_NOTE_MAX } from "@/lib/orders/closed-date-rules";
import { primaryId } from "./_shared";
export { CLOSED_DATE_NOTE_MAX };
import { organizations } from "./tenancy";


export const closedDates = pgTable(
  "closed_dates",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** Shown to customers on the closed-day banner. Null = no note. */
    publicNote: text("public_note"),
    /** Auth user id who added it. Loose, not a foreign key: a staff record leaving must not break history. */
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("closed_dates_range_check", sql`${table.endDate} >= ${table.startDate}`),
    check(
      "closed_dates_note_check",
      sql`${table.publicNote} IS NULL OR char_length(${table.publicNote}) BETWEEN 1 AND ${sql.raw(String(CLOSED_DATE_NOTE_MAX))}`,
    ),
    index("closed_dates_org_end_idx").on(table.orgId, table.endDate),
  ],
);
