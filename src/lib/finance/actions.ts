"use server";

/**
 * Finance writes. Roadmap 1.4.
 *
 * A refund moves money back out of the business after the sale is closed —
 * the obvious lever for till fraud — so it needs `orders.refund` (OWNER,
 * ADMIN, MANAGER; deliberately not CASHIER) and every one lands a
 * `refunds` row and an audit row with the person who did it.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { fromRupees } from "@/lib/money";
import { refundPayment } from "@/lib/repositories/payments";

export type RefundActionResult = { ok: true; refundId: string } | { ok: false; error: string };

const refundSchema = z.object({
  paymentId: z.uuid(),
  /** Rupees as typed — "150" or "150.50". Parsed by the money module, never by Number(). */
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 150 or 150.50."),
  reason: z.string().trim().min(3, "Say why, in a few words.").max(200),
});

export async function refundPaymentAction(input: unknown): Promise<RefundActionResult> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("orders.refund");
    const result = await refundPayment({
      paymentId: parsed.data.paymentId,
      amount: fromRupees(parsed.data.amount),
      reason: parsed.data.reason,
      actorUserId: staff.userId,
      actorRoles: staff.roles,
      orgId: staff.orgId,
    });
    if (result.ok) {
      revalidatePath("/app/finance");
      revalidatePath("/app/orders");
      revalidatePath(`/order/${result.orderId}`);
      return { ok: true, refundId: result.refundId };
    }
    return { ok: false, error: result.error };
  } catch (error) {
    if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { ok: false, error: "Refunds need a manager or the owner." };
    throw error;
  }
}
