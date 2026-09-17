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

/** Per payment: what went back (SUCCEEDED) and what is held (RESERVED). FAILED counts for neither. */
export function refundsByPayment(rows: readonly (Pick<RefundFacts, "status" | "amount"> & { readonly paymentId: string })[]): Map<string, { readonly refunded: Paise; readonly reserved: Paise }> {
  const out = new Map<string, { refunded: Paise; reserved: Paise }>();
  for (const row of rows) {
    if (row.status === "FAILED") continue;
    const found = out.get(row.paymentId) ?? { refunded: ZERO, reserved: ZERO };
    out.set(row.paymentId, row.status === "SUCCEEDED" ? { ...found, refunded: add(found.refunded, row.amount) } : { ...found, reserved: add(found.reserved, row.amount) });
  }
  return out;
}
