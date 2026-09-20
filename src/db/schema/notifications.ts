/**
 * The notification outbox (roadmap 7.2). One row is one message that should go
 * out for one order reaching one status on one channel. Migration PENDING_notification_outbox.
 *
 * The unique (org, order, channel, to_status) is the idempotency: enqueueing
 * the same status change twice, from a retried request or a re-run job, is one
 * row and so one message. `to_phone` is personal data: it is never logged, and
 * is copied here because the order's phone may change after the fact.
 * Written only through Drizzle as `postgres`.
 */

import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { primaryId } from "./_shared";
import { orderStatusEnum, orders } from "./orders";
import { organizations } from "./tenancy";

export const OUTBOX_STATUSES = ["PENDING", "SENT", "FAILED", "SKIPPED"] as const;

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("WHATSAPP"),
    toStatus: orderStatusEnum("to_status").notNull(),
    template: text("template").notNull(),
    toPhone: text("to_phone").notNull(),
    body: text("body").notNull(),
    status: text("status").$type<(typeof OUTBOX_STATUSES)[number]>().notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    /** Never contains a phone number. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    unique("notification_outbox_once_key").on(table.orgId, table.orderId, table.channel, table.toStatus),
    check("notification_outbox_status_check", sql`${table.status} IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')`),
    check("notification_outbox_sent_check", sql`(${table.status} = 'SENT') = (${table.sentAt} IS NOT NULL)`),
    index("notification_outbox_pending_idx").on(table.orgId, table.createdAt).where(sql`${table.status} = 'PENDING'`),
  ],
);
