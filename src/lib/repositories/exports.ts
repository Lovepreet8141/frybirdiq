import "server-only";

/**
 * Data for the CSV downloads on FINANCE › Exports. Roadmap 5.4.
 *
 * The payments and expenses exports read `getPaymentsLedger` and
 * `listExpenses` — already-org-scoped repository functions the Payments and
 * Expenses screens use — rather than a second query against the same
 * tables. This file adds the two exports that had no repository function
 * yet: every order in a range, and GST collected by rate.
 *
 * Every query here filters on `orgId` itself. The app connects to Postgres
 * as `postgres`, which bypasses row-level security — see CLAUDE.md and
 * `org.ts`. An unscoped query here would hand one organization's orders and
 * tax figures to whoever asked, which for a download is worse than a screen:
 * nobody watches it render.
 */

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, payments } from "@/db/schema";
import type { OrderChannel } from "@/domain/order-channel";
import type { FulfilmentType } from "@/domain/order-status";
import type { DateRange } from "@/lib/dates";
import { type Bps, type Paise, ZERO, paise } from "@/lib/money";
import { splitTax } from "@/lib/tax/gst";
import { PAID_PAYMENT_STATUSES, hasPaidPayment } from "./analytics";

/** A safety cap on a single download — a month at one QSR outlet never approaches this. */
const EXPORT_ROW_LIMIT = 10_000;

export interface OrderExportRow {
  readonly orderNumber: string;
  readonly businessDate: string;
  readonly placedAt: Date | null;
  readonly channel: OrderChannel;
  readonly fulfilment: FulfilmentType;
  readonly status: string;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly subtotal: Paise;
  readonly discountTotal: Paise;
  readonly taxableTotal: Paise;
  readonly cgstTotal: Paise;
  readonly sgstTotal: Paise;
  readonly igstTotal: Paise;
  readonly taxTotal: Paise;
  readonly deliveryFee: Paise;
  readonly grandTotal: Paise;
  readonly invoiceNumber: string | null;
  /**
   * Whether a payment against this order was taken and not fully refunded — a
   * payment in `PAID_PAYMENT_STATUSES`. The payments table's answer, never the
   * order status's: a cancelled order with a captured payment still says paid.
   */
  readonly isPaid: boolean;
  readonly paymentMethod: string | null;
  readonly cancellationReason: string | null;
}

/** Every order placed in a range, whatever its status — an export is a record, not a working list. */
export async function listOrdersForExport(orgId: string, range: DateRange): Promise<readonly OrderExportRow[]> {
  const database = db();

  const rows = await database
    .select()
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, range.from), lt(orders.createdAt, range.to)))
    .orderBy(asc(orders.createdAt))
    .limit(EXPORT_ROW_LIMIT);

  if (rows.length === 0) return [];

  const orderIds = rows.map((row) => row.id);
  const paymentRows = await database
    .select({ orderId: payments.orderId, status: payments.status, method: payments.method, createdAt: payments.createdAt })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), inArray(payments.orderId, orderIds)));

  // A paid row (captured, or captured then partly refunded) beats anything
  // else — whatever else was attempted, that row is the payment that
  // actually happened.
  const paymentByOrder = new Map<string, { paid: boolean; method: string }>();
  for (const row of paymentRows) {
    const existing = paymentByOrder.get(row.orderId);
    if (!existing || !existing.paid) {
      paymentByOrder.set(row.orderId, { paid: isPaidStatus(row.status), method: row.method });
    }
  }

  return rows.map((row) => {
    const payment = paymentByOrder.get(row.id);
    return {
      orderNumber: row.orderNumber,
      businessDate: row.businessDate,
      placedAt: row.placedAt,
      channel: row.channel,
      fulfilment: row.fulfilment,
      status: row.status,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      subtotal: paise(row.subtotal),
      discountTotal: paise(row.discountTotal),
      taxableTotal: paise(row.taxableTotal),
      cgstTotal: paise(row.cgstTotal),
      sgstTotal: paise(row.sgstTotal),
      igstTotal: paise(row.igstTotal),
      taxTotal: paise(row.taxTotal),
      deliveryFee: paise(row.deliveryFee),
      grandTotal: paise(row.grandTotal),
      invoiceNumber: row.invoiceNumber,
      isPaid: payment?.paid ?? false,
      paymentMethod: payment?.method ?? null,
      cancellationReason: row.cancellationReason,
    };
  });
}

export interface GstSummaryRow {
  readonly rateBps: Bps;
  readonly taxable: Paise;
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly igst: Paise;
  readonly total: Paise;
  readonly orderCount: number;
}

/**
 * GST actually collected, by rate, for a date range — CGST + SGST + total,
 * the figures a GST return needs. Scoped to the same paid-order set as
 * `analytics.ts`'s `paidOrders`: a payment in `PAID_PAYMENT_STATUSES`, counted
 * once however many rows match, and not a cancelled/failed/refunded order,
 * because tax on money that never arrived was never collected. A partially
 * refunded order still reports its full tax — TODO(dec-9).
 *
 * `order_items` carries `line_tax` (CGST+SGST combined) per line, not the
 * split — the split only exists at the order level, already summed across
 * every rate on that order. Grouped by rate here, the combined figure is run
 * back through `splitTax` from `src/lib/tax/gst`, the same function that
 * produced the order-level split in the first place. FRYBIRD sells only
 * intra-state (see that module's own note), so every rate group splits
 * CGST/SGST with IGST at zero — consistent with `orders.igst_total` today.
 */
export async function gstSummaryByRate(orgId: string, range: DateRange): Promise<readonly GstSummaryRow[]> {
  const rows = await db()
    .select({
      rateBps: orderItems.taxRateBps,
      taxable: sql<string>`coalesce(sum(${orderItems.lineTaxable}), 0)`,
      tax: sql<string>`coalesce(sum(${orderItems.lineTax}), 0)`,
      orderCount: sql<number>`count(distinct ${orderItems.orderId})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.orgId, orgId),
        eq(orders.orgId, orgId),
        hasPaidPayment(orders.id),
        gte(orders.createdAt, range.from),
        lt(orders.createdAt, range.to),
        sql`${orders.status} NOT IN ('CANCELLED', 'FAILED', 'REFUNDED')`,
      ),
    )
    .groupBy(orderItems.taxRateBps)
    .orderBy(asc(orderItems.taxRateBps));

  return rows.map((row) => {
    const tax = paise(BigInt(row.tax));
    const split = tax > ZERO ? splitTax(tax, "intra-state") : { cgst: ZERO, sgst: ZERO, igst: ZERO };
    return {
      rateBps: row.rateBps,
      taxable: paise(BigInt(row.taxable)),
      cgst: split.cgst,
      sgst: split.sgst,
      igst: split.igst,
      total: tax,
      orderCount: row.orderCount,
    };
  });
}

function isPaidStatus(status: string): boolean {
  return (PAID_PAYMENT_STATUSES as readonly string[]).includes(status);
}
