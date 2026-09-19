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
import { parseContactPhone } from "./phone";
import { type DeliveryBandInput, updateDeliveryPricing } from "@/lib/repositories/delivery";

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
  phone: z.string().transform((value, ctx) => {
    const parsed = parseContactPhone(value);
    if (parsed.ok) return parsed.value;
    ctx.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }),
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

export type DeliveryPricingActionResult = { ok: true } | { ok: false; error: string };

const rupeeAmount = (max: number, message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, message)
    .refine((value) => Number(value) <= max, `That's an unusually high figure — check it, or contact support if it's genuinely right.`);

const optionalRupeeAmount = (max: number, message: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(rupeeAmount(max, message).nullable());

const optionalKm = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .pipe(
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter a distance in kilometres, like 3 or 3.5.")
      .refine((value) => Number(value) > 0 && Number(value) <= 50, "Enter a distance between 0 and 50 km.")
      .nullable(),
  );

const deliveryBandInputSchema = z.object({
  upToKm: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a distance in kilometres, like 3 or 3.5.")
    .refine((value) => Number(value) > 0 && Number(value) <= 50, "A band's distance has to be between 0 and 50 km."),
  flatFee: rupeeAmount(5_000, "Enter a delivery fee in rupees, like 30."),
  perKmFee: rupeeAmount(1_000, "Enter a per-km fee in rupees, like 10 — or 0 for none."),
});

const deliveryPricingSchema = z
  .object({
    freeEnabled: z.boolean(),
    freeAboveOrderValue: optionalRupeeAmount(50_000, "Enter the minimum order value in rupees, like 300."),
    freeMaxKm: optionalKm,
    bands: z.array(deliveryBandInputSchema).min(1, "Add at least one distance band — delivery has nothing to charge without one.").max(10, "That's a lot of bands — combine some nearby tiers."),
  })
  .refine((value) => !value.freeEnabled || value.freeAboveOrderValue !== null, {
    message: "Set a minimum order value before turning free delivery on.",
    path: ["freeAboveOrderValue"],
  })
  .refine(
    (value) => {
      const kms = value.bands.map((band) => Number(band.upToKm));
      return kms.every((km, index) => index === 0 || km > kms[index - 1]!);
    },
    { message: "Distance bands must be in increasing order, each further than the last.", path: ["bands"] },
  );

export interface DeliveryPricingActionInput {
  readonly freeEnabled: boolean;
  /** Rupees, as typed. Empty string means "not set". */
  readonly freeAboveOrderValue: string;
  /** Kilometres, as typed. Empty string means "no distance restriction". */
  readonly freeMaxKm: string;
  readonly bands: readonly { readonly upToKm: string; readonly flatFee: string; readonly perKmFee: string }[];
}

/**
 * The whole "Delivery Pricing" section — the free-delivery rule and the
 * distance bands — saved together. `settings.manage`, re-checked here
 * regardless of what the page rendered (§41); the same permission every
 * other restaurant-settings write already uses, nothing broadened for this.
 *
 * A plain async function taking a structured object, not `(prevState,
 * formData)` — bands are a dynamic-length list, and `purchase-order-form.tsx`
 * already established this shape as how this codebase submits one.
 */
export async function updateDeliveryPricingAction(input: DeliveryPricingActionInput): Promise<DeliveryPricingActionResult> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { ok: false, error: "You don't have permission to change restaurant settings." };
  }

  const parsed = deliveryPricingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  const bands: DeliveryBandInput[] = parsed.data.bands.map((band) => ({
    upToMetres: Math.round(Number(band.upToKm) * 1000),
    flatFee: fromRupees(band.flatFee),
    perKmFee: fromRupees(band.perKmFee),
  }));

  const result = await updateDeliveryPricing(staff.orgId, {
    freeEnabled: parsed.data.freeEnabled,
    freeAboveOrderValue: parsed.data.freeAboveOrderValue === null ? null : fromRupees(parsed.data.freeAboveOrderValue),
    freeMaxMetres: parsed.data.freeMaxKm === null ? null : Math.round(Number(parsed.data.freeMaxKm) * 1000),
    bands,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/app/admin/restaurant");
  revalidatePath("/checkout");
  revalidatePath("/cart");
  return { ok: true };
}
