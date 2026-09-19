import "server-only";
import { cache } from "react";
import { getOrg } from "@/lib/repositories/org";
import { getOrderingStatus } from "@/lib/repositories/shop-status";
import type { ShopOrderingState } from "./shop-hours";

/**
 * The customer pages' one read of "are we taking orders": through
 * `getOrderingStatus` only (ops-1 RULE 1), once per request. Null when the shop
 * cannot be read; callers then leave the server gate to decide.
 */
export const getCustomerOrderingStatus = cache(async (): Promise<ShopOrderingState | null> => {
  const org = await getOrg();
  return org ? getOrderingStatus(org.id) : null;
});
