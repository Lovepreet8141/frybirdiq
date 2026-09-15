"use server";

/**
 * Operations settings — kitchen capacity and the opening date.
 *
 * A settings change, not a deploy: the Overview reads both on the next
 * request. `settings.manage` is OWNER-only and re-checked here regardless
 * of the page that rendered the form (§41).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { fromRupees } from "@/lib/money";
import {
  updateBusinessProfile,
  updateLocationProfile,
  updateOperationsSettings,
  updatePaymentSettings,
} from "@/lib/repositories/settings";

export type OperationsSettingsState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message: string };

const schema = z.object({
  kitchenCapacity: z.coerce.number().int().min(1, "The kitchen can carry at least 1 ticket.").max(200, "200 open tickets is beyond any single kitchen."),
  openedOn: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the opening date as a calendar date.").nullable()),
});

export async function updateOperationsSettingsAction(_previous: OperationsSettingsState, formData: FormData): Promise<OperationsSettingsState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: "You don't have permission to change restaurant settings." };
  }

  const parsed = schema.safeParse({
    kitchenCapacity: String(formData.get("kitchenCapacity") ?? ""),
    openedOn: String(formData.get("openedOn") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  if (parsed.data.openedOn && Date.parse(`${parsed.data.openedOn}T00:00:00Z`) > Date.now()) {
    return { status: "error", message: "The opening date can't be in the future." };
  }

  await updateOperationsSettings(staff.orgId, parsed.data);
  revalidatePath("/app/admin/restaurant");
  revalidatePath("/app/iq");
  return { status: "success", message: "Saved. The Overview reads these from the next load." };
}

export type SettingsFormState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message: string };

const HOURS_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const businessProfileSchema = z
  .object({
    name: z.string().trim().min(1, "The trading name can't be blank.").max(80),
    openingTime: z.string().trim().regex(HOURS_PATTERN, "Enter a time as HH:MM, 24-hour."),
    closingTime: z.string().trim().regex(HOURS_PATTERN, "Enter a time as HH:MM, 24-hour."),
  })
  .refine((value) => value.openingTime !== value.closingTime, { message: "Opening and closing time can't be the same.", path: ["closingTime"] });

/**
 * Trading name and opening hours. Read by the website's homepage and its
 * structured data (`src/lib/seo/restaurant.ts`) on the next request — a
 * save here, not a deploy, which is the acceptance bar in the roadmap: a
 * changed hour shows on frybirdiq.tech within a minute.
 */
export async function updateBusinessProfileAction(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: "You don't have permission to change restaurant settings." };
  }

  const parsed = businessProfileSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    openingTime: String(formData.get("openingTime") ?? ""),
    closingTime: String(formData.get("closingTime") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  await updateBusinessProfile(staff.orgId, parsed.data);
  revalidatePath("/app/admin/restaurant");
  revalidatePath("/");
  return { status: "success", message: "Saved. The website reads this from the next load." };
}

const locationProfileSchema = z.object({
  addressLine1: z.string().trim().min(1, "Give the house/shop/street."),
  addressLine2: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value)),
  city: z.string().trim().min(1, "The city can't be blank."),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code."),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{7,20}$/, "Enter a contact number."),
});

/** The outlet's address and phone — printed on the invoice and shown on the website. */
export async function updateLocationProfileAction(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: "You don't have permission to change restaurant settings." };
  }

  const parsed = locationProfileSchema.safeParse({
    addressLine1: String(formData.get("addressLine1") ?? ""),
    addressLine2: String(formData.get("addressLine2") ?? ""),
    city: String(formData.get("city") ?? ""),
    pincode: String(formData.get("pincode") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  const result = await updateLocationProfile(staff.orgId, parsed.data);
  if (!result.ok) return { status: "error", message: result.error };

  revalidatePath("/app/admin/restaurant");
  return { status: "success", message: "Saved." };
}

const paymentSettingsSchema = z
  .object({
    codCap: z.coerce.number().int("Enter a whole rupee amount.").min(1, "The cap has to be more than nothing.").max(100_000, "That's an unusually high cap — check the figure."),
    cashEnabled: z.coerce.boolean(),
    onlineEnabled: z.coerce.boolean(),
  })
  .refine((value) => value.cashEnabled || value.onlineEnabled, { message: "At least one payment method has to stay on — otherwise checkout has nothing to offer.", path: ["cashEnabled"] });

/**
 * The COD cap and which payment methods checkout offers.
 *
 * `cashEnabled`/`onlineEnabled` arrive as `"on"` when a checkbox is ticked
 * and are simply absent from `FormData` when it isn't — read explicitly
 * rather than trusting `z.coerce.boolean()` on a missing field, which would
 * coerce `undefined` in a way that is easy to get backwards.
 */
export async function updatePaymentSettingsAction(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: "You don't have permission to change restaurant settings." };
  }

  const parsed = paymentSettingsSchema.safeParse({
    codCap: String(formData.get("codCap") ?? ""),
    cashEnabled: formData.get("cashEnabled") === "on",
    onlineEnabled: formData.get("onlineEnabled") === "on",
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  await updatePaymentSettings(staff.orgId, {
    codCap: fromRupees(String(parsed.data.codCap)),
    cashEnabled: parsed.data.cashEnabled,
    onlineEnabled: parsed.data.onlineEnabled,
  });
  revalidatePath("/app/admin/restaurant");
  revalidatePath("/checkout");
  return { status: "success", message: "Saved. Checkout reads this from the next load." };
}
