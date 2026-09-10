"use server";

import { requirePermission } from "@/lib/auth";
import { ordersAwaitingDecision } from "@/lib/repositories/analytics";
import { formatINR, paise } from "@/lib/money";

export interface NewOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly total: string;
  readonly fulfilment: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  readonly customerName: string | null;
  readonly at: string;
  /** Whole minutes since it was placed. */
  readonly waitingMinutes: number;
}

/**
 * Orders still waiting on a yes or a no.
 *
 * Polled rather than pushed. Realtime is Phase 3; until then a poll every few
 * seconds is honest, needs no socket to stay alive, and cannot silently stop
 * working in a way nobody notices — the failure mode that matters on a counter
 * screen.
 *
 * Asking what needs a decision rather than what has just arrived means opening
 * the screen with undecided orders on it prompts immediately, instead of
 * showing nothing until the next one happens to come in.
 *
 * Permission-checked like any staff action: it returns customer names and
 * order values.
 */
export async function pollNewOrders(): Promise<{ orders: NewOrder[] }> {
  let staff;
  try {
    staff = await requirePermission("orders.view");
  } catch {
    return { orders: [] };
  }

  const rows = await ordersAwaitingDecision(staff.orgId);
  const now = Date.now();

  return {
    orders: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      total: formatINR(paise(row.grandTotal)),
      fulfilment: row.fulfilment,
      customerName: row.customerName,
      at: row.createdAt.toISOString(),
      waitingMinutes: Math.max(0, Math.floor((now - row.createdAt.getTime()) / 60_000)),
    })),
  };
}
