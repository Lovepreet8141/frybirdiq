"use server";

import { requirePermission } from "@/lib/auth";
import { type KitchenTicket, toKitchenTickets } from "@/lib/kitchen/tickets";
import { listActiveOrders } from "@/lib/repositories/orders";

/**
 * The kitchen's live tickets, polled.
 *
 * Same reasoning as `pollNewOrders`: a poll every few seconds is honest,
 * needs no socket to stay alive, and cannot silently stop working in a way
 * nobody in a kitchen would notice. Permission-checked on every call —
 * `kitchen.view` — because a ticket carries customer names.
 */
export async function pollKitchenTickets(): Promise<{ tickets: readonly KitchenTicket[] }> {
  let staff;
  try {
    staff = await requirePermission("kitchen.view");
  } catch {
    return { tickets: [] };
  }
  return { tickets: toKitchenTickets(await listActiveOrders(staff.orgId)) };
}
