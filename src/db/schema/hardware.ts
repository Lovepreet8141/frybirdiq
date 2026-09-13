/**
 * Hardware at the counter: the devices that run the POS, the printers they
 * can reach, and the print jobs that went through them.
 *
 * The cloud never talks to a printer. A printer belongs to one device — the
 * tablet standing next to it on the shop's Wi-Fi — and only that device's
 * local bridge ever opens the socket. These tables are configuration and
 * history; the bytes go over the LAN.
 *
 * Store = location. Every row carries org_id (RLS) and location_id so a
 * second outlet's device and printer can never appear in the first.
 */

import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "./_shared";
import { orders } from "./orders";
import { receiptDesigns } from "./receipt";
import { locations, organizations } from "./tenancy";

export const DEVICE_TYPES = ["DESKTOP", "TABLET", "PHONE", "POS_TERMINAL"] as const;
export const DEVICE_PLATFORMS = ["WEB", "ANDROID", "IOS", "WINDOWS", "MACOS", "LINUX"] as const;
export const PRINTER_CONNECTIONS = ["LAN", "BLUETOOTH", "USB"] as const;
export const PRINTER_STATUSES = ["ONLINE", "OFFLINE", "CONNECTING", "ERROR", "UNKNOWN", "UNAVAILABLE"] as const;
export const PRINT_JOB_STATUSES = ["QUEUED", "PRINTING", "PRINTED", "FAILED"] as const;
export const PRINT_JOB_KINDS = ["RECEIPT", "DUPLICATE", "TEST"] as const;

/** A physical device that has registered itself with FRYBIRD. Never created on a device's behalf. */
export const posDevices = pgTable(
  "pos_devices",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    /** Minted on the device itself and kept there; the same device registers to the same row. */
    deviceKey: text("device_key").notNull(),
    name: text("name").notNull(),
    deviceType: text("device_type").notNull(),
    platform: text("platform").notNull(),
    appVersion: text("app_version"),
    printerBridgeVersion: text("printer_bridge_version"),
    hardwareCapabilities: jsonb("hardware_capabilities").$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** What the device last said about its printer — a report, never a guess. */
    lastPrinterStatus: text("last_printer_status"),
    lastPrinterCheckAt: timestamp("last_printer_check_at", { withTimezone: true }),
    registeredBy: uuid("registered_by"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pos_devices_org_key_unique").on(table.orgId, table.deviceKey),
    index("pos_devices_location_idx").on(table.locationId),
    check("pos_devices_type_check", sql`${table.deviceType} IN ('DESKTOP', 'TABLET', 'PHONE', 'POS_TERMINAL')`),
    check("pos_devices_platform_check", sql`${table.platform} IN ('WEB', 'ANDROID', 'IOS', 'WINDOWS', 'MACOS', 'LINUX')`),
  ],
);

export const printers = pgTable(
  "printers",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    /** The one device whose local bridge reaches this printer. */
    deviceId: uuid("device_id")
      .notNull()
      .references(() => posDevices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    model: text("model"),
    manufacturer: text("manufacturer"),
    connectionType: text("connection_type").notNull().default("LAN"),
    ipAddress: text("ip_address"),
    port: integer("port").notNull().default(9100),
    macAddress: text("mac_address"),
    bluetoothIdentifier: text("bluetooth_identifier"),
    paperWidthMm: integer("paper_width_mm").notNull().default(80),
    protocol: text("protocol").notNull().default("ESC/POS"),
    isDefault: boolean("is_default").notNull().default(false),
    autoPrintEnabled: boolean("auto_print_enabled").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    lastStatus: text("last_status").notNull().default("UNKNOWN"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastSuccessfulPrintAt: timestamp("last_successful_print_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    index("printers_org_idx").on(table.orgId),
    index("printers_device_idx").on(table.deviceId),
    // One default receipt printer per store.
    uniqueIndex("printers_location_default_unique").on(table.locationId).where(sql`${table.isDefault} = true AND ${table.isActive} = true`),
    check("printers_connection_check", sql`${table.connectionType} IN ('LAN', 'BLUETOOTH', 'USB')`),
    check("printers_port_check", sql`${table.port} BETWEEN 1 AND 65535`),
    check("printers_paper_check", sql`${table.paperWidthMm} IN (58, 80)`),
    check("printers_status_check", sql`${table.lastStatus} IN ('ONLINE', 'OFFLINE', 'CONNECTING', 'ERROR', 'UNKNOWN', 'UNAVAILABLE')`),
  ],
);

/**
 * One print job per attempt to put a receipt on paper. The id is minted by
 * the device before anything is sent, so a retried network call lands on
 * the same row and the bridge can refuse to print the same job twice.
 */
export const printJobs = pgTable(
  "print_jobs",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => posDevices.id, { onDelete: "set null" }),
    printerId: uuid("printer_id").references(() => printers.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    receiptDesignId: uuid("receipt_design_id").references(() => receiptDesigns.id, { onDelete: "set null" }),
    kind: text("kind").notNull().default("RECEIPT"),
    status: text("status").notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    requestedBy: uuid("requested_by"),
    printedAt: timestamp("printed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("print_jobs_order_idx").on(table.orderId),
    index("print_jobs_org_created_idx").on(table.orgId, table.createdAt),
    // The customer's copy of a bill is one job; retries reuse it. A second copy is a DUPLICATE job.
    uniqueIndex("print_jobs_order_receipt_unique").on(table.orderId).where(sql`${table.kind} = 'RECEIPT'`),
    check("print_jobs_status_check", sql`${table.status} IN ('QUEUED', 'PRINTING', 'PRINTED', 'FAILED')`),
    check("print_jobs_kind_check", sql`${table.kind} IN ('RECEIPT', 'DUPLICATE', 'TEST')`),
  ],
);
