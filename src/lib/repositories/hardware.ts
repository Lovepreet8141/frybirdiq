import "server-only";

/**
 * Devices, printers and print jobs — configuration and history for the
 * hardware at the counter. The cloud stores what a device reported and
 * what the owner configured; it never opens a socket to a printer.
 *
 * Every query scopes on org_id. Store = the org's location; a printer is
 * bound to exactly one registered device, and that binding is checked
 * here before anything is saved.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, locations, posDevices, printJobs, printers } from "@/db/schema";
import type { DeviceIdentity } from "@/lib/hardware/device";
import { normaliseMac, validatePrinterAddress } from "@/lib/hardware/net";
import type { DevicePlatform, DeviceType, HardwareCapabilities, PrintJobKind, PrintJobStatus, PrinterConnectionType, PrinterStatus } from "@/lib/hardware/printer/types";

/* ------------------------------------------------------------------ */
/* Shapes (JSON-safe — they travel to client components)               */
/* ------------------------------------------------------------------ */

export interface DeviceRecord {
  readonly id: string;
  readonly deviceKey: string;
  readonly name: string;
  readonly deviceType: DeviceType;
  readonly platform: DevicePlatform;
  readonly appVersion: string | null;
  readonly bridgeVersion: string | null;
  readonly capabilities: HardwareCapabilities;
  readonly isActive: boolean;
  readonly lastSeenAt: string | null;
  readonly lastPrinterStatus: PrinterStatus | null;
  readonly lastPrinterCheckAt: string | null;
  readonly createdAt: string;
}

export interface PrinterRecord {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly deviceKey: string;
  readonly name: string;
  readonly model: string | null;
  readonly manufacturer: string | null;
  readonly connectionType: PrinterConnectionType;
  readonly ipAddress: string | null;
  readonly port: number;
  readonly macAddress: string | null;
  readonly bluetoothIdentifier: string | null;
  readonly paperWidthMm: 58 | 80;
  readonly protocol: string;
  readonly isDefault: boolean;
  readonly autoPrintEnabled: boolean;
  readonly isActive: boolean;
  readonly lastStatus: PrinterStatus;
  readonly lastSeenAt: string | null;
  readonly lastSuccessfulPrintAt: string | null;
  readonly lastError: string | null;
}

export interface PrintJobRecord {
  readonly id: string;
  readonly orderId: string | null;
  readonly printerId: string | null;
  readonly deviceId: string | null;
  readonly kind: PrintJobKind;
  readonly status: PrintJobStatus;
  readonly attempts: number;
  readonly error: string | null;
  readonly printedAt: string | null;
  readonly createdAt: string;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function capabilitiesOf(raw: Record<string, unknown>): HardwareCapabilities {
  return { printer: raw.printer === true, localPrinterBridge: raw.localPrinterBridge === true, wifi: raw.wifi === true, bluetooth: raw.bluetooth === true, usb: raw.usb === true };
}

type DeviceRow = typeof posDevices.$inferSelect;
type PrinterRow = typeof printers.$inferSelect;
type JobRow = typeof printJobs.$inferSelect;

const toDevice = (row: DeviceRow): DeviceRecord => ({
  id: row.id,
  deviceKey: row.deviceKey,
  name: row.name,
  deviceType: row.deviceType as DeviceType,
  platform: row.platform as DevicePlatform,
  appVersion: row.appVersion,
  bridgeVersion: row.printerBridgeVersion,
  capabilities: capabilitiesOf(row.hardwareCapabilities),
  isActive: row.isActive,
  lastSeenAt: iso(row.lastSeenAt),
  lastPrinterStatus: (row.lastPrinterStatus as PrinterStatus | null) ?? null,
  lastPrinterCheckAt: iso(row.lastPrinterCheckAt),
  createdAt: row.createdAt.toISOString(),
});

const toPrinter = (row: PrinterRow, device: { name: string; deviceKey: string }): PrinterRecord => ({
  id: row.id,
  deviceId: row.deviceId,
  deviceName: device.name,
  deviceKey: device.deviceKey,
  name: row.name,
  model: row.model,
  manufacturer: row.manufacturer,
  connectionType: row.connectionType as PrinterConnectionType,
  ipAddress: row.ipAddress,
  port: row.port,
  macAddress: row.macAddress,
  bluetoothIdentifier: row.bluetoothIdentifier,
  paperWidthMm: row.paperWidthMm === 58 ? 58 : 80,
  protocol: row.protocol,
  isDefault: row.isDefault,
  autoPrintEnabled: row.autoPrintEnabled,
  isActive: row.isActive,
  lastStatus: row.lastStatus as PrinterStatus,
  lastSeenAt: iso(row.lastSeenAt),
  lastSuccessfulPrintAt: iso(row.lastSuccessfulPrintAt),
  lastError: row.lastError,
});

const toJob = (row: JobRow): PrintJobRecord => ({
  id: row.id,
  orderId: row.orderId,
  printerId: row.printerId,
  deviceId: row.deviceId,
  kind: row.kind as PrintJobKind,
  status: row.status as PrintJobStatus,
  attempts: row.attempts,
  error: row.error,
  printedAt: iso(row.printedAt),
  createdAt: row.createdAt.toISOString(),
});

/** The store. One location today; the first active one is the store every device and printer belongs to. */
export async function getStoreLocationId(orgId: string): Promise<string | null> {
  const [row] = await db().select({ id: locations.id }).from(locations).where(eq(locations.orgId, orgId)).orderBy(locations.createdAt).limit(1);
  return row?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

/** A device registering itself. Same key → same row; a re-register refreshes what it reports. */
export async function registerDevice(orgId: string, actorUserId: string, identity: DeviceIdentity): Promise<DeviceRecord | null> {
  const locationId = await getStoreLocationId(orgId);
  if (!locationId) return null;
  const now = new Date();
  const [existing] = await db().select().from(posDevices).where(and(eq(posDevices.orgId, orgId), eq(posDevices.deviceKey, identity.deviceKey))).limit(1);
  if (existing) {
    const [updated] = await db()
      .update(posDevices)
      .set({
        // A name the owner set stays; the device only supplies one the first time.
        deviceType: identity.deviceType,
        platform: identity.platform,
        appVersion: identity.appVersion,
        printerBridgeVersion: identity.bridgeVersion,
        hardwareCapabilities: { ...identity.capabilities },
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(posDevices.id, existing.id))
      .returning();
    return updated ? toDevice(updated) : null;
  }
  const [created] = await db()
    .insert(posDevices)
    .values({
      orgId,
      locationId,
      deviceKey: identity.deviceKey,
      name: identity.name,
      deviceType: identity.deviceType,
      platform: identity.platform,
      appVersion: identity.appVersion,
      printerBridgeVersion: identity.bridgeVersion,
      hardwareCapabilities: { ...identity.capabilities },
      lastSeenAt: now,
      registeredBy: actorUserId,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    const [raced] = await db().select().from(posDevices).where(and(eq(posDevices.orgId, orgId), eq(posDevices.deviceKey, identity.deviceKey))).limit(1);
    return raced ? toDevice(raced) : null;
  }
  await db().insert(auditLogs).values({ orgId, actorUserId, action: "device_registered", entity: "pos_devices", entityId: created.id, after: { name: created.name, platform: created.platform, deviceType: created.deviceType } });
  return toDevice(created);
}

export interface HeartbeatReport {
  readonly deviceKey: string;
  readonly appVersion: string | null;
  readonly bridgeVersion: string | null;
  readonly capabilities: HardwareCapabilities | null;
  readonly printerId: string | null;
  readonly printerStatus: PrinterStatus | null;
  readonly printerError: string | null;
}

/** "I'm here, and this is what my printer looks like from where I stand." */
export async function recordHeartbeat(orgId: string, report: HeartbeatReport): Promise<DeviceRecord | null> {
  const now = new Date();
  const [device] = await db()
    .update(posDevices)
    .set({
      lastSeenAt: now,
      appVersion: report.appVersion ?? undefined,
      printerBridgeVersion: report.bridgeVersion ?? undefined,
      hardwareCapabilities: report.capabilities ? { ...report.capabilities } : undefined,
      lastPrinterStatus: report.printerStatus ?? undefined,
      lastPrinterCheckAt: report.printerStatus ? now : undefined,
      updatedAt: now,
    })
    .where(and(eq(posDevices.orgId, orgId), eq(posDevices.deviceKey, report.deviceKey)))
    .returning();
  if (!device) return null;
  if (report.printerId && report.printerStatus) {
    await db()
      .update(printers)
      .set({ lastStatus: report.printerStatus, lastSeenAt: report.printerStatus === "ONLINE" ? now : undefined, lastError: report.printerStatus === "ONLINE" ? null : (report.printerError ?? undefined), updatedAt: now })
      .where(and(eq(printers.orgId, orgId), eq(printers.id, report.printerId), eq(printers.deviceId, device.id)));
  }
  return toDevice(device);
}

export async function listDevices(orgId: string): Promise<readonly DeviceRecord[]> {
  const rows = await db().select().from(posDevices).where(and(eq(posDevices.orgId, orgId), eq(posDevices.isActive, true))).orderBy(desc(posDevices.lastSeenAt));
  return rows.map(toDevice);
}

export async function findDeviceByKey(orgId: string, deviceKey: string): Promise<DeviceRecord | null> {
  const [row] = await db().select().from(posDevices).where(and(eq(posDevices.orgId, orgId), eq(posDevices.deviceKey, deviceKey))).limit(1);
  return row ? toDevice(row) : null;
}

export async function renameDevice(orgId: string, actorUserId: string, deviceId: string, name: string): Promise<boolean> {
  const [row] = await db().update(posDevices).set({ name, updatedAt: new Date() }).where(and(eq(posDevices.orgId, orgId), eq(posDevices.id, deviceId))).returning({ id: posDevices.id });
  if (row) await db().insert(auditLogs).values({ orgId, actorUserId, action: "device_renamed", entity: "pos_devices", entityId: deviceId, after: { name } });
  return Boolean(row);
}

/** Forget a device. Its printers go with it (cascade) — they were only ever reachable from it. */
export async function removeDevice(orgId: string, actorUserId: string, deviceId: string): Promise<boolean> {
  const [row] = await db().delete(posDevices).where(and(eq(posDevices.orgId, orgId), eq(posDevices.id, deviceId))).returning({ id: posDevices.id, name: posDevices.name });
  if (row) await db().insert(auditLogs).values({ orgId, actorUserId, action: "device_removed", entity: "pos_devices", entityId: deviceId, before: { name: row.name } });
  return Boolean(row);
}

/* ------------------------------------------------------------------ */
/* Printers                                                            */
/* ------------------------------------------------------------------ */

const printerWithDevice = () =>
  db()
    .select({ printer: printers, device: { name: posDevices.name, deviceKey: posDevices.deviceKey } })
    .from(printers)
    .innerJoin(posDevices, eq(posDevices.id, printers.deviceId));

export async function listPrinters(orgId: string): Promise<readonly PrinterRecord[]> {
  const rows = await printerWithDevice()
    .where(and(eq(printers.orgId, orgId), eq(printers.isActive, true)))
    .orderBy(desc(printers.isDefault), printers.createdAt);
  return rows.map((row) => toPrinter(row.printer, row.device));
}

export async function getPrinter(orgId: string, printerId: string): Promise<PrinterRecord | null> {
  const [row] = await printerWithDevice()
    .where(and(eq(printers.orgId, orgId), eq(printers.id, printerId)))
    .limit(1);
  return row ? toPrinter(row.printer, row.device) : null;
}

/** The printer this device prints to: its default, else its only active one. Null means "no printer for this device". */
export async function printerForDevice(orgId: string, deviceKey: string): Promise<PrinterRecord | null> {
  const rows = await printerWithDevice()
    .where(and(eq(printers.orgId, orgId), eq(printers.isActive, true), eq(posDevices.deviceKey, deviceKey)))
    .orderBy(desc(printers.isDefault), printers.createdAt)
    .limit(1);
  const row = rows[0];
  return row ? toPrinter(row.printer, row.device) : null;
}

export interface PrinterInput {
  readonly id: string | null;
  readonly deviceId: string;
  readonly name: string;
  readonly model: string | null;
  readonly manufacturer: string | null;
  readonly connectionType: PrinterConnectionType;
  readonly ipAddress: string | null;
  readonly port: number;
  readonly macAddress: string | null;
  /** Bluetooth: the paired device's address, chosen on the tablet. */
  readonly bluetoothIdentifier: string | null;
  readonly paperWidthMm: 58 | 80;
  readonly protocol: string;
  readonly isDefault: boolean;
  readonly autoPrintEnabled: boolean;
}

export type SavePrinterResult = { ok: true; printer: PrinterRecord } | { ok: false; error: string };

/** Create or update a printer. The device must be this org's; the address must be a LAN address; one default per store. */
export async function savePrinter(orgId: string, actorUserId: string, input: PrinterInput): Promise<SavePrinterResult> {
  const [device] = await db().select().from(posDevices).where(and(eq(posDevices.orgId, orgId), eq(posDevices.id, input.deviceId))).limit(1);
  if (!device) return { ok: false, error: "Choose the device that is next to the printer — it must be registered in this store." };
  if (input.connectionType === "USB") return { ok: false, error: "USB printers are not supported by the FRYBIRD POS bridge yet." };
  // LAN: a private address. Bluetooth: the paired device the person picked on the tablet (its MAC), no IP at all.
  let host: string | null = null;
  let port = input.port;
  let bluetoothIdentifier: string | null = null;
  if (input.connectionType === "LAN") {
    const address = validatePrinterAddress(input.ipAddress ?? "", input.port);
    if (!address.ok) return { ok: false, error: address.message };
    host = address.host;
    port = address.port;
  } else {
    bluetoothIdentifier = input.bluetoothIdentifier?.trim() ? normaliseMac(input.bluetoothIdentifier) : null;
    if (!bluetoothIdentifier) return { ok: false, error: "Scan for the printer on the tablet and pick it from the list — a Bluetooth printer is saved by its device address." };
    port = 1; // Unused for Bluetooth; the column is NOT NULL and checked 1–65535.
  }
  const mac = input.macAddress?.trim() ? normaliseMac(input.macAddress) : null;
  if (input.macAddress?.trim() && !mac) return { ok: false, error: "That MAC address is not valid. Use the form 24:19:7B:5B:A6:FE." };

  const now = new Date();
  const values = {
    deviceId: device.id,
    locationId: device.locationId,
    name: input.name.trim(),
    model: input.model?.trim() || null,
    manufacturer: input.manufacturer?.trim() || null,
    connectionType: input.connectionType,
    ipAddress: host,
    port,
    macAddress: mac,
    bluetoothIdentifier,
    paperWidthMm: input.paperWidthMm,
    protocol: input.protocol.trim() || "ESC/POS",
    isDefault: input.isDefault,
    autoPrintEnabled: input.autoPrintEnabled,
    updatedAt: now,
  };

  const saved = await db().transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(printers).set({ isDefault: false, updatedAt: now }).where(and(eq(printers.orgId, orgId), eq(printers.locationId, device.locationId), eq(printers.isDefault, true)));
    }
    if (input.id) {
      const [row] = await tx.update(printers).set(values).where(and(eq(printers.orgId, orgId), eq(printers.id, input.id))).returning();
      return row ?? null;
    }
    const [row] = await tx.insert(printers).values({ orgId, ...values }).returning();
    return row ?? null;
  });
  if (!saved) return { ok: false, error: "That printer no longer exists." };

  await db().insert(auditLogs).values({ orgId, actorUserId, action: input.id ? "printer_updated" : "printer_added", entity: "printers", entityId: saved.id, after: { name: saved.name, model: saved.model, device: device.name, ip: saved.ipAddress, port: saved.port, isDefault: saved.isDefault, autoPrint: saved.autoPrintEnabled } });
  return { ok: true, printer: toPrinter(saved, { name: device.name, deviceKey: device.deviceKey }) };
}

export async function deletePrinter(orgId: string, actorUserId: string, printerId: string): Promise<boolean> {
  const [row] = await db().delete(printers).where(and(eq(printers.orgId, orgId), eq(printers.id, printerId))).returning({ id: printers.id, name: printers.name });
  if (row) await db().insert(auditLogs).values({ orgId, actorUserId, action: "printer_removed", entity: "printers", entityId: printerId, before: { name: row.name } });
  return Boolean(row);
}

/** What the device that owns this printer just observed. Only that device may report. */
export async function recordPrinterStatus(orgId: string, deviceKey: string, printerId: string, status: PrinterStatus, error: string | null): Promise<void> {
  const now = new Date();
  await db()
    .update(printers)
    .set({ lastStatus: status, lastSeenAt: status === "ONLINE" ? now : undefined, lastError: status === "ONLINE" ? null : error, updatedAt: now })
    .where(and(eq(printers.orgId, orgId), eq(printers.id, printerId), sql`${printers.deviceId} IN (SELECT ${posDevices.id} FROM ${posDevices} WHERE ${posDevices.orgId} = ${orgId} AND ${posDevices.deviceKey} = ${deviceKey})`));
}

/* ------------------------------------------------------------------ */
/* Print jobs                                                          */
/* ------------------------------------------------------------------ */

export interface NewPrintJob {
  /** Minted on the device, so a retried request lands on the same job. */
  readonly id: string;
  readonly orderId: string | null;
  readonly printerId: string;
  readonly deviceKey: string;
  readonly kind: PrintJobKind;
  readonly receiptDesignId: string | null;
  readonly requestedBy: string;
}

export type CreatePrintJobResult = { ok: true; job: PrintJobRecord; existing: boolean } | { ok: false; error: string };

/**
 * One job per receipt. A RECEIPT job for an order that already has one
 * returns that job (a retry, not a second copy); a DUPLICATE is always a
 * new job. The printer must be bound to the device that is asking.
 */
export async function createPrintJob(orgId: string, input: NewPrintJob): Promise<CreatePrintJobResult> {
  const [binding] = await db()
    .select({ printerId: printers.id, deviceId: posDevices.id, locationId: printers.locationId })
    .from(printers)
    .innerJoin(posDevices, eq(posDevices.id, printers.deviceId))
    .where(and(eq(printers.orgId, orgId), eq(printers.id, input.printerId), eq(posDevices.deviceKey, input.deviceKey), eq(printers.isActive, true)))
    .limit(1);
  if (!binding) return { ok: false, error: "This device is not the one connected to that printer." };

  const [byId] = await db().select().from(printJobs).where(and(eq(printJobs.orgId, orgId), eq(printJobs.id, input.id))).limit(1);
  if (byId) return { ok: true, job: toJob(byId), existing: true };

  if (input.kind === "RECEIPT" && input.orderId) {
    const [receiptJob] = await db().select().from(printJobs).where(and(eq(printJobs.orgId, orgId), eq(printJobs.orderId, input.orderId), eq(printJobs.kind, "RECEIPT"))).limit(1);
    if (receiptJob) return { ok: true, job: toJob(receiptJob), existing: true };
  }

  const [created] = await db()
    .insert(printJobs)
    .values({ id: input.id, orgId, locationId: binding.locationId, deviceId: binding.deviceId, printerId: binding.printerId, orderId: input.orderId, receiptDesignId: input.receiptDesignId, kind: input.kind, status: "QUEUED", requestedBy: input.requestedBy })
    .onConflictDoNothing()
    .returning();
  if (created) return { ok: true, job: toJob(created), existing: false };
  const [raced] = await db().select().from(printJobs).where(and(eq(printJobs.orgId, orgId), eq(printJobs.id, input.id))).limit(1);
  return raced ? { ok: true, job: toJob(raced), existing: true } : { ok: false, error: "Could not record the print job." };
}

/** The device reporting how an attempt went. PRINTED is final; FAILED can be retried on the same job. */
export async function reportPrintJob(orgId: string, jobId: string, outcome: { status: "PRINTING" | "PRINTED" | "FAILED"; error: string | null }): Promise<PrintJobRecord | null> {
  const now = new Date();
  const [row] = await db()
    .update(printJobs)
    .set({
      status: outcome.status,
      error: outcome.status === "PRINTED" ? null : outcome.error,
      attempts: outcome.status === "PRINTING" ? sql`${printJobs.attempts} + 1` : undefined,
      printedAt: outcome.status === "PRINTED" ? now : undefined,
      updatedAt: now,
    })
    .where(and(eq(printJobs.orgId, orgId), eq(printJobs.id, jobId)))
    .returning();
  if (!row) return null;
  if (row.printerId) {
    await db()
      .update(printers)
      .set(outcome.status === "PRINTED" ? { lastSuccessfulPrintAt: now, lastSeenAt: now, lastStatus: "ONLINE", lastError: null, updatedAt: now } : outcome.status === "FAILED" ? { lastError: outcome.error, lastStatus: "OFFLINE", updatedAt: now } : { updatedAt: now })
      .where(and(eq(printers.orgId, orgId), eq(printers.id, row.printerId)));
  }
  return toJob(row);
}

export async function listPrintJobsForOrder(orgId: string, orderId: string): Promise<readonly PrintJobRecord[]> {
  const rows = await db().select().from(printJobs).where(and(eq(printJobs.orgId, orgId), eq(printJobs.orderId, orderId))).orderBy(desc(printJobs.createdAt));
  return rows.map(toJob);
}

export async function recentPrintJobs(orgId: string, limit = 20): Promise<readonly PrintJobRecord[]> {
  const rows = await db().select().from(printJobs).where(eq(printJobs.orgId, orgId)).orderBy(desc(printJobs.createdAt)).limit(limit);
  return rows.map(toJob);
}

/** The active receipt design's id, so a job records which design it printed. */
export async function activeReceiptDesignId(orgId: string): Promise<string | null> {
  const [row] = await db().execute<{ id: string }>(sql`SELECT id FROM receipt_designs WHERE org_id = ${orgId} AND active IS NOT NULL LIMIT 1`);
  return row?.id ?? null;
}
