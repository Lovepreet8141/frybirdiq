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
