"use server";

import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { ordersSince } from "@/lib/repositories/analytics";
import { formatINR, paise } from "@/lib/money";

export interface NewOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly total: string;
  readonly fulfilment: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  readonly customerName: string | null;
  readonly at: string;
}

/**
 * Orders that have arrived since a moment.
 *
 * Polled rather than pushed. Realtime is Phase 3; until then a poll every few
 * seconds is honest, needs no socket to stay alive, and cannot silently stop
 * working in a way nobody notices — which is the failure mode that matters on
 * a counter screen.
 *
 * Permission-checked like any other staff action: this returns customer names
 * and order values.
 */
export async function pollNewOrders(input: unknown): Promise<{ orders: NewOrder[]; checkedAt: string }> {
  const parsed = z.object({ since: z.iso.datetime() }).safeParse(input);
  const checkedAt = new Date().toISOString();
  if (!parsed.success) return { orders: [], checkedAt };

  let staff;
  try {
    staff = await requirePermission("orders.view");
  } catch {
    return { orders: [], checkedAt };
  }

  const rows = await ordersSince(staff.orgId, new Date(parsed.data.since));

  return {
    orders: rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      total: formatINR(paise(row.grandTotal)),
      fulfilment: row.fulfilment,
      customerName: row.customerName,
      at: row.createdAt.toISOString(),
    })),
    checkedAt,
  };
}
