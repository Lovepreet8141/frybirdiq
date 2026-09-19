import "server-only";
import { cache } from "react";
import { getOrg } from "@/lib/repositories/org";
import { getOrderingStatus } from "@/lib/repositories/shop-status";
import { readStatusSafely } from "./safe-status";
import type { ShopOrderingState } from "./shop-hours";

/**
 * The customer pages' one read of "are we taking orders": through
 * `getOrderingStatus` only (ops-1 RULE 1), once per request. Null when the shop
 * cannot be read or the read fails (logged): the banner is on every page, so a
 * failed read must not take them down. Callers then fail open and the server
 * gate in `placeOrder` still decides.
 */
export const getCustomerOrderingStatus = cache(
  (): Promise<ShopOrderingState | null> =>
    readStatusSafely(async () => {
      const org = await getOrg();
      return org ? getOrderingStatus(org.id) : null;
    }),
);
