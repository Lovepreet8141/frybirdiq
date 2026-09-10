import "server-only";

/**
 * Saved delivery addresses.
 *
 * Only ever returned for a signed-in customer. Looking them up by a typed
 * phone number would hand one customer's doorstep to anyone who knows their
 * number — the same weakness that makes account linking wait on an OTP.
 *
 * Guests are not made to retype either: their last address is remembered in a
 * cookie on their own device, which cannot leak across people because it never
 * leaves the browser that made it.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { addresses } from "@/db/schema";
import { fromMicro } from "@/lib/delivery";

export interface SavedAddress {
  readonly id: string;
  readonly line1: string;
  readonly landmark: string | null;
  readonly lat: number;
  readonly lng: number;
}

export async function listSavedAddresses(customerId: string): Promise<readonly SavedAddress[]> {
  const rows = await db()
    .select()
    .from(addresses)
    .where(eq(addresses.customerId, customerId))
    .orderBy(desc(addresses.updatedAt))
    .limit(6);

  return rows
    .filter((row) => row.latMicro !== null && row.lngMicro !== null)
    .map((row) => ({
      id: row.id,
      line1: row.line1,
      landmark: row.landmark,
      lat: fromMicro(row.latMicro!),
      lng: fromMicro(row.lngMicro!),
    }));
}
