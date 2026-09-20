/**
 * The till (roadmap 5.1-5.3): cash sessions and rider cash handovers.
 * Migration 0041.
 *
 * A cash session is one open-to-close stretch of a till: the float put in, the
 * cash counted at the end, the cash the books say should be there (a snapshot
 * taken when it closes) and the difference, against the person who closed it.
 * Every counter cash payment taken while a session is open is attached to it
 * (`payments.cash_session_id`), so "expected" is a sum over rows, never a
 * remembered number.
 *
 * Cash a rider takes at the door is NOT in the till: it is held by the rider
 * (`payments.held_by_rider`) until a handover puts it into the open session,
 * and the handover records what the rider declared against what the payments
 * say, against the rider.
 *
 * All money is integer paise in a bigint. The app writes as `postgres`; a
 * Supabase key may read its own org's rows and nothing more (0041's RLS).
 */

import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { money, primaryId } from "./_shared";
import { locations, organizations } from "./tenancy";

export const CASH_SESSION_STATUSES = ["OPEN", "CLOSED"] as const;
export const CASH_NOTE_MAX = 200;

export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    status: text("status").$type<(typeof CASH_SESSION_STATUSES)[number]>().notNull().default("OPEN"),
    /** Auth user ids. Loose, not foreign keys: a staff record leaving must not break the till's history. */
    openedBy: uuid("opened_by").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    openingFloat: money("opening_float").notNull(),
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** What the person counted in the drawer. */
    countedCash: money("counted_cash"),
    /** Float + cash taken in the session - cash refunded out of it, worked out from rows when it closed. */
    expectedCash: money("expected_cash"),
    /** counted - expected: negative is short, positive is over. Recorded against `closed_by`. */
    variance: money("variance"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One till open at a time per location: a second cash payment has exactly one session to attach to.
    uniqueIndex("cash_sessions_one_open_idx").on(table.orgId, table.locationId).where(sql`${table.status} = 'OPEN'`),
    index("cash_sessions_org_opened_idx").on(table.orgId, table.openedAt),
    check("cash_sessions_status_check", sql`${table.status} IN ('OPEN', 'CLOSED')`),
    check("cash_sessions_float_check", sql`${table.openingFloat} >= 0`),
    // A session is either open with nothing closed, or closed with every closing fact present.
    check(
      "cash_sessions_closed_check",
      sql`(${table.status} = 'OPEN' AND ${table.closedBy} IS NULL AND ${table.closedAt} IS NULL AND ${table.countedCash} IS NULL AND ${table.expectedCash} IS NULL AND ${table.variance} IS NULL)
        OR (${table.status} = 'CLOSED' AND ${table.closedBy} IS NOT NULL AND ${table.closedAt} IS NOT NULL AND ${table.countedCash} IS NOT NULL AND ${table.expectedCash} IS NOT NULL AND ${table.variance} IS NOT NULL AND ${table.countedCash} >= 0 AND ${table.variance} = ${table.countedCash} - ${table.expectedCash})`,
    ),
    check("cash_sessions_note_check", sql`${table.note} IS NULL OR char_length(${table.note}) BETWEEN 1 AND ${sql.raw(String(CASH_NOTE_MAX))}`),
  ],
);

export const cashHandovers = pgTable(
  "cash_handovers",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The open session the rider's cash went into. */
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cashSessions.id, { onDelete: "restrict" }),
    riderUserId: uuid("rider_user_id").notNull(),
    receivedBy: uuid("received_by").notNull(),
    /** What the rider's door payments add up to: the books' figure. */
    expectedAmount: money("expected_amount").notNull(),
    /** What the rider handed over. */
    declaredAmount: money("declared_amount").notNull(),
    /** declared - expected: negative means the rider is short. Recorded against `rider_user_id`. */
    variance: money("variance").notNull(),
    paymentCount: integer("payment_count").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cash_handovers_org_created_idx").on(table.orgId, table.createdAt),
    check("cash_handovers_amounts_check", sql`${table.expectedAmount} >= 0 AND ${table.declaredAmount} >= 0 AND ${table.variance} = ${table.declaredAmount} - ${table.expectedAmount} AND ${table.paymentCount} >= 1`),
    check("cash_handovers_note_check", sql`${table.note} IS NULL OR char_length(${table.note}) BETWEEN 1 AND ${sql.raw(String(CASH_NOTE_MAX))}`),
  ],
);
