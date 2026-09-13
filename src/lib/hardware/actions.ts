"use server";

/**
 * Hardware — the server side of devices, printers and print jobs.
 *
 * Registering, heartbeats, printer status and print jobs are things a
 * POS device does about itself, so they take `orders.create` (anyone who
 * can run the till). Adding, editing or removing a printer or device is
 * configuration and takes `integrations.manage` (OWNER, ADMIN). A second
 * copy of a bill takes `orders.refund` — the same "a manager decides"
 * line as giving money back.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, type Staff, requirePermission } from "@/lib/auth";
import type { Permission } from "@/domain/permissions";
import { validatePrinterAddress } from "@/lib/hardware/net";
import { type CreatePrintJobResult, type DeviceRecord, type PrintJobRecord, type PrinterRecord, type SavePrinterResult, activeReceiptDesignId, createPrintJob, deletePrinter, findDeviceByKey, printerForDevice, recordHeartbeat, recordPrinterStatus, registerDevice, removeDevice, renameDevice, reportPrintJob, savePrinter } from "@/lib/repositories/hardware";

type Fail = { readonly ok: false; readonly error: string };

async function authorise(permission: Permission): Promise<Staff | Fail> {
  try {
    return await requirePermission(permission);
  } catch (error) {
    if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { ok: false, error: "Your role cannot do that." };
    throw error;
  }
}

const capabilitiesSchema = z.object({ printer: z.boolean(), localPrinterBridge: z.boolean(), wifi: z.boolean(), bluetooth: z.boolean(), usb: z.boolean() });
const statusSchema = z.enum(["ONLINE", "OFFLINE", "CONNECTING", "ERROR", "UNKNOWN", "UNAVAILABLE"]);
const HARDWARE_PATH = "/app/admin/hardware";

/* ---- devices ------------------------------------------------------- */

const registerSchema = z.object({
  deviceKey: z.string().min(16).max(120),
  name: z.string().trim().min(1).max(80),
  deviceType: z.enum(["DESKTOP", "TABLET", "PHONE", "POS_TERMINAL"]),
  platform: z.enum(["WEB", "ANDROID", "IOS", "WINDOWS", "MACOS", "LINUX"]),
  appVersion: z.string().max(40).nullable(),
  bridgeVersion: z.string().max(40).nullable(),
  capabilities: capabilitiesSchema,
});

export type RegisterDeviceResult = { ok: true; device: DeviceRecord; printer: PrinterRecord | null } | Fail;

/** A real device announcing itself. Creates the row the first time; refreshes it after. */
export async function registerDeviceAction(raw: unknown): Promise<RegisterDeviceResult> {
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That device description is not valid." };
  const staff = await authorise("orders.create");
  if ("ok" in staff) return staff;
  const device = await registerDevice(staff.orgId, staff.userId, parsed.data);
  if (!device) return { ok: false, error: "No store is configured yet." };
  const printer = await printerForDevice(staff.orgId, device.deviceKey);
  revalidatePath(HARDWARE_PATH);
  return { ok: true, device, printer };
}

/** What this device is, according to the server — registered or not, and which printer it prints to. */
export async function whoAmIAction(deviceKey: string): Promise<{ ok: true; device: DeviceRecord | null; printer: PrinterRecord | null } | Fail> {
  if (typeof deviceKey !== "string" || deviceKey.length < 16) return { ok: false, error: "No device key." };
  const staff = await authorise("orders.create");
  if ("ok" in staff) return staff;
  const device = await findDeviceByKey(staff.orgId, deviceKey);
  const printer = device ? await printerForDevice(staff.orgId, deviceKey) : null;
  return { ok: true, device, printer };
}

const heartbeatSchema = z.object({
  deviceKey: z.string().min(16).max(120),
  appVersion: z.string().max(40).nullable(),
  bridgeVersion: z.string().max(40).nullable(),
  capabilities: capabilitiesSchema.nullable(),
  printerId: z.string().uuid().nullable(),
  printerStatus: statusSchema.nullable(),
  printerError: z.string().max(300).nullable(),
});

export async function heartbeatAction(raw: unknown): Promise<{ ok: true; printer: PrinterRecord | null } | Fail> {
  const parsed = heartbeatSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That heartbeat is not valid." };
  const staff = await authorise("orders.create");
  if ("ok" in staff) return staff;
  const device = await recordHeartbeat(staff.orgId, parsed.data);
  if (!device) return { ok: false, error: "This device is not registered." };
  // Configuration may have changed from another screen: hand back the printer this device should be using.
  return { ok: true, printer: await printerForDevice(staff.orgId, parsed.data.deviceKey) };
}

export async function renameDeviceAction(deviceId: string, name: string): Promise<{ ok: true } | Fail> {
  const parsed = z.object({ deviceId: z.string().uuid(), name: z.string().trim().min(1).max(80) }).safeParse({ deviceId, name });
  if (!parsed.success) return { ok: false, error: "Give the device a name up to 80 characters." };
  const staff = await authorise("integrations.manage");
  if ("ok" in staff) return staff;
  const ok = await renameDevice(staff.orgId, staff.userId, parsed.data.deviceId, parsed.data.name);
  revalidatePath(HARDWARE_PATH);
  return ok ? { ok: true } : { ok: false, error: "That device no longer exists." };
}

export async function removeDeviceAction(deviceId: string): Promise<{ ok: true } | Fail> {
  if (!z.string().uuid().safeParse(deviceId).success) return { ok: false, error: "Not a device." };
  const staff = await authorise("integrations.manage");
  if ("ok" in staff) return staff;
  const ok = await removeDevice(staff.orgId, staff.userId, deviceId);
  revalidatePath(HARDWARE_PATH);
  return ok ? { ok: true } : { ok: false, error: "That device no longer exists." };
}

/* ---- printers ------------------------------------------------------ */

const printerSchema = z.object({
  id: z.string().uuid().nullable(),
  deviceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  model: z.string().trim().max(80).nullable(),
  manufacturer: z.string().trim().max(80).nullable(),
  connectionType: z.enum(["LAN", "BLUETOOTH", "USB"]),
  ipAddress: z.string().trim().max(45).nullable(),
  port: z.number().int().min(1).max(65535),
  macAddress: z.string().trim().max(20).nullable(),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
  protocol: z.string().trim().min(1).max(20),
  isDefault: z.boolean(),
  autoPrintEnabled: z.boolean(),
});

export async function savePrinterAction(raw: unknown): Promise<SavePrinterResult> {
  const parsed = printerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the printer details." };
  const staff = await authorise("integrations.manage");
  if ("ok" in staff) return staff;
  const result = await savePrinter(staff.orgId, staff.userId, parsed.data);
  if (result.ok) {
    revalidatePath(HARDWARE_PATH);
    revalidatePath("/app/pos");
  }
  return result;
}

export async function deletePrinterAction(printerId: string): Promise<{ ok: true } | Fail> {
  if (!z.string().uuid().safeParse(printerId).success) return { ok: false, error: "Not a printer." };
  const staff = await authorise("integrations.manage");
  if ("ok" in staff) return staff;
  const ok = await deletePrinter(staff.orgId, staff.userId, printerId);
  revalidatePath(HARDWARE_PATH);
  revalidatePath("/app/pos");
  return ok ? { ok: true } : { ok: false, error: "That printer no longer exists." };
}

const printerStatusSchema = z.object({ deviceKey: z.string().min(16).max(120), printerId: z.string().uuid(), status: statusSchema, error: z.string().max(300).nullable() });

/** The device bound to a printer reporting what it just saw. */
export async function reportPrinterStatusAction(raw: unknown): Promise<{ ok: true } | Fail> {
  const parsed = printerStatusSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That status report is not valid." };
  const staff = await authorise("orders.create");
  if ("ok" in staff) return staff;
  await recordPrinterStatus(staff.orgId, parsed.data.deviceKey, parsed.data.printerId, parsed.data.status, parsed.data.error);
  return { ok: true };
}

/* ---- print jobs ---------------------------------------------------- */

const newJobSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid().nullable(),
  printerId: z.string().uuid(),
  deviceKey: z.string().min(16).max(120),
  kind: z.enum(["RECEIPT", "DUPLICATE", "TEST"]),
});

/** Record a job before the bytes go to the bridge. Idempotent on the job id and on (order, RECEIPT). */
export async function createPrintJobAction(raw: unknown): Promise<CreatePrintJobResult> {
  const parsed = newJobSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That print job is not valid." };
  const staff = await authorise(parsed.data.kind === "DUPLICATE" ? "orders.refund" : "orders.create");
  if ("ok" in staff) return { ok: false, error: parsed.data.kind === "DUPLICATE" ? "Printing a second copy of a bill needs a manager." : staff.error };
  const receiptDesignId = parsed.data.kind === "TEST" ? null : await activeReceiptDesignId(staff.orgId);
  return createPrintJob(staff.orgId, { ...parsed.data, receiptDesignId, requestedBy: staff.userId });
}

const reportJobSchema = z.object({ id: z.string().uuid(), status: z.enum(["PRINTING", "PRINTED", "FAILED"]), error: z.string().max(300).nullable() });

export async function reportPrintJobAction(raw: unknown): Promise<{ ok: true; job: PrintJobRecord } | Fail> {
  const parsed = reportJobSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That job report is not valid." };
  const staff = await authorise("orders.create");
  if ("ok" in staff) return staff;
  const job = await reportPrintJob(staff.orgId, parsed.data.id, parsed.data);
  return job ? { ok: true, job } : { ok: false, error: "That print job no longer exists." };
}

/** Server-side check a form can call before saving: is this a LAN address? */
export async function checkPrinterAddressAction(host: string, port: number): Promise<{ ok: true } | Fail> {
  const checked = validatePrinterAddress(String(host), Number(port));
  return checked.ok ? { ok: true } : { ok: false, error: checked.message };
}

