/**
 * Pure display logic for the customer web receipt — order-type wording,
 * clock formatting, payment labels and the FRYBIRD REWARDS summary. Split
 * out of `<FrybirdReceipt>` so it can be unit tested the way every other
 * pure function in `src/lib` is, with no React and no database.
 *
 * Nothing here decides a business rule (whether a reward is unlocked, how
 * many points were earned) — it only chooses which sentence describes a
 * result that `src/lib/receipt/customer-view.ts` already computed.
 */

import type { Paise } from "@/lib/money";
import { formatINR, isZero } from "@/lib/money";
import type { ReceiptRewards } from "./customer-view";

const IST = "Asia/Kolkata";

export function formatReceiptWhen(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatReceiptTime(date: Date): string {
  return date.toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
}

/** Null for an ASAP order — nothing was requested, so there is nothing to print. */
export function scheduledTimeLabel(scheduledFor: Date | null): string | null {
  return scheduledFor ? `Requested for ${formatReceiptTime(scheduledFor)}` : null;
}

export function orderTypeLabel(channel: string, fulfilment: "DELIVERY" | "TAKEAWAY" | "DINE_IN"): string {
  const way = fulfilment === "DELIVERY" ? "delivery" : "collection";
  return channel === "ONLINE" ? `Online ${way}` : way[0]!.toUpperCase() + way.slice(1);
}

const PAYMENT_METHOD_LABELS: Record<string, string> = { UPI: "UPI", CASH: "Cash", CARD: "Card", NETBANKING: "Net banking", WALLET: "Wallet", OTHER: "Other" };
const PAYMENT_STATUS_LABELS: Record<string, string> = { CAPTURED: "Paid", PENDING: "Pending", AUTHORIZED: "Authorized", FAILED: "Failed", REFUNDED: "Refunded", PARTIALLY_REFUNDED: "Partially refunded" };

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export type RewardsSummary =
  | { readonly kind: "hidden" }
  | { readonly kind: "redeemed"; readonly amount: string }
  | { readonly kind: "ready"; readonly worth: string }
  | { readonly kind: "progress"; readonly stampsRemaining: number; readonly worth: string };

/**
 * Which message the FRYBIRD REWARDS panel shows, in priority order:
 * a free item this order actually spent beats a free item sitting ready for
 * a future order, which beats plain progress. `hidden` means the whole
 * panel should not render — no account, or the stamp programme is off,
 * decided upstream by `customer-view.ts`, never re-derived here.
 */
export function summarizeRewards(rewards: ReceiptRewards | null, stampRewardDiscount: Paise): RewardsSummary {
  if (!rewards) return { kind: "hidden" };
  if (!isZero(stampRewardDiscount)) return { kind: "redeemed", amount: formatINR(stampRewardDiscount) };
  if (rewards.availableRewardCount > 0) return { kind: "ready", worth: formatINR(rewards.maxRewardValue) };
  return { kind: "progress", stampsRemaining: Math.max(0, rewards.stampsRequired - rewards.stampCount), worth: formatINR(rewards.maxRewardValue) };
}
