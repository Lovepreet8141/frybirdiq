import "server-only";

/**
 * The customer web receipt's view model — composed once, here, from data that
 * already exists and is already authoritative. Nothing in this file computes
 * a price, a tax figure, a discount or a loyalty balance; it reads
 * `getInvoice` (which reads the order the way it was actually billed) and
 * `src/lib/repositories/loyalty.ts` (which reads the account's live ledger),
 * and shapes the result for `<FrybirdReceipt>` to render.
 *
 * Money stays `Paise` here, not a formatted string — `formatINR` is called
 * only at the render boundary, same rule as everywhere else in the app.
 *
 * Deliberately separate from `src/lib/receipt/data.ts` (`ReceiptData`), which
 * belongs to the POS thermal-printer designer and is not touched by this
 * feature — two different documents for two different surfaces, reading the
 * same underlying order without duplicating how it is priced.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { loyaltyStampEvents, organizations } from "@/db/schema";
import { type Invoice, getInvoice } from "@/lib/repositories/invoice";
import { getOrg } from "@/lib/repositories/org";
import { getPointsBalance, getStampAccountState } from "@/lib/repositories/loyalty";
import { type Paise, paise } from "@/lib/money";

export interface ReceiptRewards {
  readonly pointsEarnedThisOrder: number;
  /** Null when the customer has no points account yet. */
  readonly pointsBalance: number | null;
  readonly stampEarnedThisOrder: boolean;
  readonly stampCount: number;
  readonly stampsRequired: number;
  readonly availableRewardCount: number;
  readonly maxRewardValue: Paise;
}

export interface CustomerReceiptData extends Invoice {
  readonly isTaxInvoice: boolean;
  /** Null when this order's customer has no account, or the stamp programme is off. */
  readonly rewards: ReceiptRewards | null;
}

/**
 * One order's receipt, ready to render. Returns null exactly when `getInvoice`
 * would — the caller (`/order/[id]/invoice`) turns that into a 404, the same
 * as it does today.
 *
 * Access is unchanged: holding the order's UUID is what grants it, as on
 * `/order/[id]`. The order is also bound to this site's organization, resolved
 * server-side through `getOrg` and never taken from the request, so another
 * organization's order id returns null rather than its customer's details.
 */
export async function getCustomerReceipt(orderId: string): Promise<CustomerReceiptData | null> {
  const org = await getOrg();
  if (!org) return null;

  const invoice = await getInvoice(org.id, orderId);
  if (!invoice) return null;

  const isTaxInvoice = Boolean(invoice.seller.gstin);
  const rewards = await loadRewards(invoice);

  return { ...invoice, isTaxInvoice, rewards };
}

async function loadRewards(invoice: Invoice): Promise<ReceiptRewards | null> {
  if (!invoice.customerId) return null;

  const [org] = await db().select({ stampRewardEnabled: organizations.stampRewardEnabled, stampsRequired: organizations.stampsRequired, stampMaxRewardValue: organizations.stampMaxRewardValue }).from(organizations).where(eq(organizations.id, invoice.orgId)).limit(1);
  if (!org?.stampRewardEnabled) return null;

  const [stampState, pointsBalance, stampEvent] = await Promise.all([
    getStampAccountState(invoice.customerId, invoice.orgId),
    getPointsBalance(invoice.customerId, invoice.orgId),
    db()
      .select({ id: loyaltyStampEvents.id })
      .from(loyaltyStampEvents)
      .where(
        and(
          eq(loyaltyStampEvents.orgId, invoice.orgId),
          eq(loyaltyStampEvents.orderId, invoice.orderId),
          isNull(loyaltyStampEvents.reversedAt),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return {
    pointsEarnedThisOrder: invoice.pointsEarned,
    pointsBalance,
    stampEarnedThisOrder: Boolean(stampEvent),
    stampCount: stampState?.stampCount ?? 0,
    stampsRequired: org.stampsRequired,
    availableRewardCount: stampState?.availableRewards.length ?? 0,
    maxRewardValue: paise(org.stampMaxRewardValue),
  };
}
