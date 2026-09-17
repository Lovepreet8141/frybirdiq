import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { type RangeKey, resolveRange } from "@/lib/dates";
import { toCsv } from "@/lib/exports/csv";
import { exportFilename } from "@/lib/exports/filename";
import { formatBps, toPlainDecimal } from "@/lib/money";
import { listExpenses } from "@/lib/repositories/expenses";
import { getPaymentsLedger } from "@/lib/repositories/finance";
import { gstSummaryByRate, listOrdersForExport } from "@/lib/repositories/exports";

export const dynamic = "force-dynamic";

const EXPORT_TYPES = ["orders", "payments", "expenses", "gst-summary"] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

const RANGE_KEYS = new Set<RangeKey>(["today", "yesterday", "7d", "30d", "mtd", "lastMonth"]);

/** A large export row cap — see finance.ts and exports.ts for why. */
const PAYMENTS_EXPORT_LIMIT = 10_000;
const EXPENSES_EXPORT_LIMIT = 10_000;

/**
 * Downloads a CSV. `?type=orders|payments|expenses|gst-summary&range=<RangeKey>`.
 *
 * A Route Handler rather than a Server Action: the browser has to navigate
 * to this for `Content-Disposition: attachment` to trigger a save dialog, and
 * a Server Action's response is consumed by the form/fetch that called it,
 * not by the browser's download machinery.
 *
 * `requirePermission("reports.export")` runs on every request this handler
 * ever serves — the Exports page hides the buttons from anyone without the
 * permission (§41's "hiding a button is not authorization"), but this check,
 * not that hiding, is what actually stops the download. A signed-out or
 * under-permissioned request gets a plain JSON error, never a CSV.
 */
export async function GET(request: Request): Promise<Response> {
  let staff;
  try {
    staff = await requirePermission("reports.export");
  } catch {
    return NextResponse.json({ error: "You don't have permission to export reports." }, { status: 403 });
  }

  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const type = (EXPORT_TYPES as readonly string[]).includes(typeParam ?? "") ? (typeParam as ExportType) : null;
  if (!type) {
    return NextResponse.json({ error: `Unknown export type. Use one of: ${EXPORT_TYPES.join(", ")}.` }, { status: 400 });
  }

  const rangeParam = url.searchParams.get("range");
  const rangeKey: RangeKey = RANGE_KEYS.has(rangeParam as RangeKey) ? (rangeParam as RangeKey) : "mtd";
  const range = resolveRange(rangeKey);

  let csv: string;

  switch (type) {
    case "orders": {
      const rows = await listOrdersForExport(staff.orgId, range);
      csv = toCsv(
        [
          "order_number", "business_date", "placed_at", "channel", "fulfilment", "status",
          "customer_name", "customer_phone",
          "subtotal", "discount", "taxable", "cgst", "sgst", "igst", "tax_total",
          "delivery_fee", "grand_total", "invoice_number", "paid", "payment_method", "cancellation_reason",
        ],
        rows.map((r) => [
          r.orderNumber, r.businessDate, r.placedAt?.toISOString() ?? "", r.channel, r.fulfilment, r.status,
          r.customerName, r.customerPhone,
          toPlainDecimal(r.subtotal), toPlainDecimal(r.discountTotal), toPlainDecimal(r.taxableTotal),
          toPlainDecimal(r.cgstTotal), toPlainDecimal(r.sgstTotal), toPlainDecimal(r.igstTotal), toPlainDecimal(r.taxTotal),
          toPlainDecimal(r.deliveryFee), toPlainDecimal(r.grandTotal), r.invoiceNumber,
          r.isPaid ? "yes" : "no", r.paymentMethod, r.cancellationReason,
        ]),
      );
      break;
    }
    case "payments": {
      const ledger = await getPaymentsLedger(staff.orgId, range, PAYMENTS_EXPORT_LIMIT);
      csv = toCsv(
        ["order_number", "channel", "status", "method", "provider", "amount", "fee", "captured_by", "at", "refunded", "provider_payment_id"],
        ledger.payments.map((r) => [
          r.orderNumber, r.channel, r.status, r.method, r.provider,
          toPlainDecimal(r.amount), toPlainDecimal(r.feeAmount), r.capturedBy,
          r.at.toISOString(), toPlainDecimal(r.refunded), r.providerPaymentId,
        ]),
      );
      break;
    }
    case "expenses": {
      const rows = await listExpenses(staff.orgId, range, EXPENSES_EXPORT_LIMIT);
      csv = toCsv(
        ["date", "description", "category", "behaviour", "account", "amount"],
        rows.map((r) => [r.paidOn, r.description, r.categoryName, r.behaviour, r.accountName, toPlainDecimal(r.amount)]),
      );
      break;
    }
    case "gst-summary": {
      const rows = await gstSummaryByRate(staff.orgId, range);
      csv = toCsv(
        ["rate", "taxable", "cgst", "sgst", "igst", "total_tax", "orders"],
        rows.map((r) => [formatBps(r.rateBps), toPlainDecimal(r.taxable), toPlainDecimal(r.cgst), toPlainDecimal(r.sgst), toPlainDecimal(r.igst), toPlainDecimal(r.total), r.orderCount]),
      );
      break;
    }
  }

  // IST business dates, not UTC — see `exportFilename`.
  const filename = exportFilename(type, range);

  // A leading BOM so Excel opens the file as UTF-8 rather than guessing at
  // the system codepage — the failure mode is a customer's name with a
  // non-ASCII character turning into "Ã¯Â¿Â½" on a Windows till.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
