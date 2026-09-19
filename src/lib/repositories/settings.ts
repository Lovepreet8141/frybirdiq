import "server-only";

/**
 * The restaurant's own configuration, read for display.
 *
 * Every value here is live business configuration that already drives the
 * app — the GSTIN on every invoice, the price basis behind every margin,
 * the stamp threshold behind every free item, the delivery bands behind
 * every quote — and until now none of it had a screen. Read-only on
 * purpose: several of these (price basis above all, see CLAUDE.md) are
 * decisions with consequences, and an edit form for each is its own
 * approval. Nothing here writes.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, organizations, taxRates } from "@/db/schema";
import { type Paise, paise } from "@/lib/money";
import type { PriceBasis } from "@/lib/pricing";
import { parseContactPhone } from "@/lib/settings/phone";
import { type DeliverySettings, getDeliverySettings } from "./delivery";

export interface RestaurantSettings {
  readonly organization: {
    readonly name: string;
    readonly legalName: string | null;
    readonly gstin: string | null;
    readonly currency: string;
    readonly timezone: string;
    readonly priceBasis: PriceBasis;
    /** Open tickets the kitchen can carry at once — "Kitchen load" on the Overview is measured against this. */
    readonly kitchenCapacity: number;
    /** YYYY-MM-DD, or null until the owner sets it. */
    readonly openedOn: string | null;
    /** 24-hour "HH:MM" — what the website's "Kitchen hours" reads. Roadmap 5.5. */
    readonly openingTime: string;
    readonly closingTime: string;
    /** The most a customer can owe cash before checkout insists on online payment. */
    readonly codCap: Paise;
    readonly cashEnabled: boolean;
    /** The business's own switch, on top of whether Razorpay is actually configured. */
    readonly onlineEnabled: boolean;
  };
  readonly loyalty: {
    readonly earnBps: number;
    readonly pointValue: Paise;
    readonly minRedeemPoints: number;
    readonly stampsEnabled: boolean;
    readonly stampsRequired: number;
    readonly stampMinOrderValue: Paise;
    readonly stampMaxRewardValue: Paise;
  };
  readonly location: {
    readonly name: string;
    readonly addressLine1: string | null;
    readonly addressLine2: string | null;
    readonly city: string | null;
    readonly state: string | null;
    readonly stateCode: string | null;
    readonly pincode: string | null;
    readonly phone: string | null;
    readonly isActive: boolean;
  } | null;
  readonly delivery: DeliverySettings | null;
  readonly taxRates: readonly { id: string; name: string; rateBps: number; hsnCode: string | null; isDefault: boolean }[];
}

export async function getRestaurantSettings(orgId: string): Promise<RestaurantSettings | null> {
  const database = db();
  const [org] = await database.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return null;

  const [[location], rates, delivery] = await Promise.all([
    database.select().from(locations).where(eq(locations.orgId, orgId)).orderBy(asc(locations.createdAt)).limit(1),
    database
      .select({ id: taxRates.id, name: taxRates.name, rateBps: taxRates.rateBps, hsnCode: taxRates.hsnCode, isDefault: taxRates.isDefault })
      .from(taxRates)
      .where(eq(taxRates.orgId, orgId))
      .orderBy(asc(taxRates.rateBps)),
    getDeliverySettings(),
  ]);

  return {
    organization: {
      name: org.name,
      legalName: org.legalName,
      gstin: org.gstin,
      currency: org.currency,
      timezone: org.timezone,
      priceBasis: org.priceBasis,
      kitchenCapacity: org.kitchenCapacity,
      openedOn: org.openedOn,
      openingTime: org.openingTime,
      closingTime: org.closingTime,
      codCap: paise(org.codCap),
      cashEnabled: org.cashEnabled,
      onlineEnabled: org.onlineEnabled,
    },
    loyalty: {
      earnBps: org.loyaltyEarnBps,
      pointValue: paise(org.loyaltyPointValue),
      minRedeemPoints: org.loyaltyMinRedeemPoints,
      stampsEnabled: org.stampRewardEnabled,
      stampsRequired: org.stampsRequired,
      stampMinOrderValue: paise(org.stampMinOrderValue),
      stampMaxRewardValue: paise(org.stampMaxRewardValue),
    },
    location: location
      ? {
          name: location.name,
          addressLine1: location.addressLine1,
          addressLine2: location.addressLine2,
          city: location.city,
          state: location.state,
          stateCode: location.stateCode,
          pincode: location.pincode,
          phone: location.phone,
          isActive: location.isActive,
        }
      : null,
    delivery,
    taxRates: rates,
  };
}

/**
 * The operations settings the Overview reads. The one write in this file —
 * a settings change, like the rewards rules: read on the next request,
 * no deploy. Permission is the caller's (`settings.manage`, checked in the
 * action), the division every repository write here follows.
 */
export async function updateOperationsSettings(
  orgId: string,
  input: { readonly kitchenCapacity: number; readonly openedOn: string | null },
): Promise<void> {
  await db()
    .update(organizations)
    .set({ kitchenCapacity: input.kitchenCapacity, openedOn: input.openedOn, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}

/**
 * Trading name and opening hours. Roadmap 5.5.
 *
 * Deliberately not on this form: legal name, GSTIN, menu prices (price
 * basis) and currency. Those are read-only on the Restaurant page for a
 * reason CLAUDE.md is explicit about — price basis above all, where
 * changing it retroactively misstates every past margin. This function only
 * ever touches `name`, `opening_time` and `closing_time`.
 */
export async function updateBusinessProfile(
  orgId: string,
  input: { readonly name: string; readonly openingTime: string; readonly closingTime: string },
): Promise<void> {
  await db()
    .update(organizations)
    .set({ name: input.name, openingTime: input.openingTime, closingTime: input.closingTime, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}

/**
 * The outlet's address and phone. Roadmap 5.5.
 *
 * Deliberately not on this form: GST state / state code, which decides
 * CGST+SGST versus IGST on every order billed here — a tax-adjacent fact,
 * not a profile field, and out of scope for this slice same as GSTIN.
 *
 * Updates the org's first location, the same one `getRestaurantSettings`
 * reads — FRYBIRD is single-location today; a second location would need
 * its own row and its own screen, not a second field on this one.
 */
export async function updateLocationProfile(
  orgId: string,
  input: {
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly city: string;
    readonly pincode: string;
    readonly phone: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const database = db();
  const phone = parseContactPhone(input.phone);
  if (!phone.ok) return { ok: false, error: phone.error };
  const [location] = await database.select({ id: locations.id }).from(locations).where(eq(locations.orgId, orgId)).orderBy(asc(locations.createdAt)).limit(1);
  if (!location) return { ok: false, error: "No outlet is configured yet." };

  await database
    .update(locations)
    .set({
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      pincode: input.pincode,
      phone: phone.value,
      updatedAt: new Date(),
    })
    .where(eq(locations.id, location.id));

  return { ok: true };
}

/**
 * The COD cap and which payment methods are offered. Roadmap 5.5.
 *
 * `cashEnabled` and `onlineEnabled` are the business's own switch, read
 * alongside `isRazorpayConfigured()` by `availableMethods()` — this can turn
 * online off even when Razorpay has keys, but cannot turn it on without
 * them. The caller (`updatePaymentSettingsAction`) refuses to save both
 * switches off, so checkout is never left with nothing to offer.
 */
export async function updatePaymentSettings(
  orgId: string,
  input: { readonly codCap: Paise; readonly cashEnabled: boolean; readonly onlineEnabled: boolean },
): Promise<void> {
  await db()
    .update(organizations)
    .set({ codCap: input.codCap, cashEnabled: input.cashEnabled, onlineEnabled: input.onlineEnabled, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}
