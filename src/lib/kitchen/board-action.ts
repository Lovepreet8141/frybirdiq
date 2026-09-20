"use server";

import { requirePermission } from "@/lib/auth";
import type { KitchenTicket } from "@/lib/kitchen/tickets";
import { loadKitchenTickets } from "@/lib/repositories/kitchen-board";

/**
 * The kitchen board's poll, with prep targets. Supersedes `pollKitchenTickets`
 * (src/lib/auth/kitchen-action.ts), which returns tickets without a target.
 * Permission-checked on every call — `kitchen.view` — because a ticket carries
 * customer names.
 */
export async function pollKitchenBoard(): Promise<{ tickets: readonly KitchenTicket[] }> {
  let staff;
  try {
    staff = await requirePermission("kitchen.view");
  } catch {
    return { tickets: [] };
  }
  return { tickets: await loadKitchenTickets(staff.orgId) };
}
