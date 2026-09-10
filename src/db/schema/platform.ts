/** Idempotency, audit, webhooks, analytics, AI. BUILD-PLAN.md §17, §39, §45, §52. */

import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";
import { primaryId, timestamps } from "./_shared";

/**
 * Idempotency. §17.
 *
 * A mobile browser on a bad connection retries. A payment webhook is delivered
 * twice. Neither may create a second order. The caller sends a key, the server
 * stores the response against it, and a replay returns the stored response
 * rather than doing the work again.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: primaryId(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** "createOrder", "capturePayment" — a key is only valid for its operation. */
    operation: text("operation").notNull(),
    requestId: text("request_id"),
    /** Hash of the request body, to catch a key reused with different content. */
    requestFingerprint: text("request_fingerprint"),
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [unique("idempotency_keys_unique").on(table.key, table.operation)],
);

/** §52. Before and after, so a change can be explained and reversed. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id"),
    actorUserId: uuid("actor_user_id"),
    /** "price_changed", "refund_created", "staff_role_changed". */
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_org_created_idx").on(table.orgId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entity, table.entityId),
  ],
);

/**
 * Received webhooks. §45.
 *
 * Persisted before processing so a failure can be replayed, and unique on the
 * provider's event id so a redelivery is recognised rather than reprocessed.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: primaryId(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    signatureVerified: text("signature_verified").notNull().default("false"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("webhook_events_unique").on(table.provider, table.eventId)],
);

/**
 * Product analytics. §39.
 *
 * Deliberately separate from orders and payments. §39: "Business metrics
 * should come from authoritative transaction data, not only analytics events."
 * Revenue is never read from this table.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: primaryId(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id"),
    name: text("name").notNull(),
    sessionId: text("session_id"),
    userId: uuid("user_id"),
    properties: jsonb("properties").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("analytics_events_org_name_idx").on(table.orgId, table.name, table.occurredAt)],
);

/** AI conversations, messages and tool calls. §31, §32, §83. */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: primaryId(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    /** "concierge" for a customer, "copilot" for the owner. */
    surface: text("surface").notNull(),
    userId: uuid("user_id"),
    customerId: uuid("customer_id"),
    sessionId: text("session_id"),
    ...timestamps,
  },
  (table) => [index("ai_conversations_org_idx").on(table.orgId, table.surface)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: primaryId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: jsonb("content").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_messages_conversation_idx").on(table.conversationId, table.createdAt)],
);

/**
 * Every tool the model invoked, with its arguments and result. §32.
 *
 * Logged because a recommendation has to be explainable after the fact, and
 * because §33 forbids invented figures — this table is how a wrong number gets
 * traced back to the query that produced it.
 */
export const aiToolCalls = pgTable(
  "ai_tool_calls",
  {
    id: primaryId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => aiMessages.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    arguments: jsonb("arguments").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    durationMs: text("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_tool_calls_conversation_idx").on(table.conversationId)],
);

export const integrations = pgTable(
  "integrations",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** "razorpay", "swiggy", "zomato", "whatsapp". */
    provider: text("provider").notNull(),
    /** Never a secret. Credentials belong in the secret store, not a table. */
    config: jsonb("config").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("DISCONNECTED"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [unique("integrations_org_provider_unique").on(table.orgId, table.provider)],
);
