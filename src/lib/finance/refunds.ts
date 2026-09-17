/**
 * How the finance screens read refund rows (refund design Revision 2, slice 5).
 *
 * A refund row is RESERVED when approved, before money moves; SUCCEEDED when
 * the money went back (dated by `finalized_at`); FAILED when the provider
 * refused (no money moved). Only SUCCEEDED is ever summed as refunded.
 * RESERVED is money held against a payment — shown, and counted against what
 * is left to refund, but never reported as returned. FAILED is listed for the
 * record and never summed.
 *
 * Pure: rows in, figures out; all arithmetic through `src/lib/money`.
 */

import { type Paise, ZERO, add } from "@/lib/money";

export const REFUND_STATUSES = ["RESERVED", "SUCCEEDED", "FAILED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * How long a refund may stay RESERVED before it is flagged as stuck: a cash
 * refund is a hand-over at the counter, an online one waits on the gateway
 * (design §1b sig.refund_reserved_stale: 15 min cash, 60 min online).
 */
export const STALE_RESERVED_MS = { cash: 15 * 60_000, online: 60 * 60_000 } as const;

export interface RefundFacts {
  readonly status: RefundStatus;
  readonly amount: Paise;
  readonly provider: string;
  readonly createdAt: Date;
  readonly finalizedAt: Date | null;
}

/** The instant a refund belongs to: when the money went back for SUCCEEDED, when it was asked for otherwise. */
export function refundDate(row: Pick<RefundFacts, "status" | "createdAt" | "finalizedAt">): Date {
  return row.status === "SUCCEEDED" && row.finalizedAt !== null ? row.finalizedAt : row.createdAt;
}

/** A RESERVED refund older than its provider's limit. */
export function isStaleReserved(row: Pick<RefundFacts, "status" | "provider" | "createdAt">, now: Date): boolean {
  if (row.status !== "RESERVED") return false;
  const limit = row.provider === "cash" ? STALE_RESERVED_MS.cash : STALE_RESERVED_MS.online;
  return now.getTime() - row.createdAt.getTime() > limit;
}

export interface RefundSummary {
  /** Σ SUCCEEDED — the only figure ever called "refunded". */
  readonly refundedTotal: Paise;
  readonly refundedCount: number;
  /** Σ RESERVED — held, not yet returned. */
  readonly reservedTotal: Paise;
  readonly reservedCount: number;
  readonly staleReservedCount: number;
  /** FAILED rows are counted, never summed. */
  readonly failedCount: number;
}

export function summariseRefunds(rows: readonly RefundFacts[], now: Date): RefundSummary {
  const succeeded = rows.filter((row) => row.status === "SUCCEEDED");
  const reserved = rows.filter((row) => row.status === "RESERVED");
  return {
    refundedTotal: add(...succeeded.map((row) => row.amount)),
    refundedCount: succeeded.length,
    reservedTotal: add(...reserved.map((row) => row.amount)),
    reservedCount: reserved.length,
    staleReservedCount: reserved.filter((row) => isStaleReserved(row, now)).length,
    failedCount: rows.filter((row) => row.status === "FAILED").length,
  };
}

export interface PaymentRefunds {
  /** Σ SUCCEEDED. */
  readonly refunded: Paise;
  /** Σ RESERVED. */
  readonly reserved: Paise;
  /** Some RESERVED refund on this payment is past its limit. */
  readonly stuck: boolean;
  /** FAILED refunds: counted, never summed. */
  readonly failedCount: number;
}

export const NO_REFUNDS: PaymentRefunds = { refunded: ZERO, reserved: ZERO, stuck: false, failedCount: 0 };

/** Per payment: what went back (SUCCEEDED), what is held (RESERVED) and whether any of it is stuck, and how many attempts failed. */
export function refundsByPayment(rows: readonly (Pick<RefundFacts, "status" | "amount" | "provider" | "createdAt"> & { readonly paymentId: string })[], now: Date): Map<string, PaymentRefunds> {
  const out = new Map<string, PaymentRefunds>();
  for (const row of rows) {
    const found = out.get(row.paymentId) ?? NO_REFUNDS;
    const next: PaymentRefunds =
      row.status === "SUCCEEDED"
        ? { ...found, refunded: add(found.refunded, row.amount) }
        : row.status === "RESERVED"
          ? { ...found, reserved: add(found.reserved, row.amount), stuck: found.stuck || isStaleReserved(row, now) }
          : { ...found, failedCount: found.failedCount + 1 };
    out.set(row.paymentId, next);
  }
  return out;
}

export type RefundBadgeKind = "in_progress" | "stuck" | "failed";

export interface RefundBadge {
  readonly kind: RefundBadgeKind;
  /** The badge's visible words. */
  readonly label: string;
  /**
   * The held amount belongs in the visible text ("Refund stuck · ₹500"), added
   * at render with formatINR — never only in a tooltip or aria-label.
   */
  readonly showsHeldAmount: boolean;
  /** The full sentence for assistive technology; the caller adds the amount at render. */
  readonly description: string;
}

/**
 * Badges beside a payment's own status for refunds that are not simply done:
 * money held by a refund in progress (or stuck past its limit), and refund
 * attempts that failed. SUCCEEDED refunds need none — the payment status
 * already says refunded or part refunded.
 */
export function paymentRefundBadges(refunds: Pick<PaymentRefunds, "reserved" | "stuck" | "failedCount">): readonly RefundBadge[] {
  const badges: RefundBadge[] = [];
  if (refunds.reserved > ZERO) {
    badges.push(
      refunds.stuck
        ? { kind: "stuck", label: "Refund stuck", showsHeldAmount: true, description: "A refund has been in progress too long and needs checking; the amount is held, not refunded" }
        : { kind: "in_progress", label: "Refund in progress", showsHeldAmount: true, description: "A refund is in progress; the amount is held, not refunded yet" },
    );
  }
  if (refunds.failedCount > 0) {
    badges.push({
      kind: "failed",
      label: refunds.failedCount === 1 ? "Refund failed" : `${refunds.failedCount} refunds failed`,
      showsHeldAmount: false,
      description: `${refunds.failedCount === 1 ? "A refund attempt" : `${refunds.failedCount} refund attempts`} failed; no money moved`,
    });
  }
  return badges;
}
