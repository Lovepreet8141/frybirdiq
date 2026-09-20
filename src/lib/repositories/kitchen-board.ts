import "server-only";

import { type KitchenTicket, toKitchenTickets } from "@/lib/kitchen/tickets";
import { getPrepTargets } from "@/lib/repositories/kitchen-targets";
import { listActiveOrders } from "@/lib/repositories/orders";

/** The kitchen's live tickets with their prep targets attached (roadmap 4.1). One place, so the page and the poll never disagree. */
export async function loadKitchenTickets(orgId: string): Promise<readonly KitchenTicket[]> {
  const active = await listActiveOrders(orgId);
  const targets = await getPrepTargets(orgId, active.map((order) => order.id));
  return toKitchenTickets(active, targets);
}
