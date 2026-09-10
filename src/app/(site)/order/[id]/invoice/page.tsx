import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { WhatsAppButton } from "@/components/order/whatsapp-button";
import { formatBps, formatINR } from "@/lib/money";
import { getInvoice } from "@/lib/repositories/invoice";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function when(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  /*
   * A document without a GSTIN is not a tax invoice, whatever it is titled.
   * Calling it one would be a false statement on a document a customer may
   * present for a claim, so it is a receipt until the GSTIN is set.
   */
  const isTaxInvoice = Boolean(invoice.seller.gstin);
  const title = isTaxInvoice ? "Tax Invoice" : "Receipt";

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-10 print:max-w-none print:px-0 print:py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/order/${invoice.orderId}`}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Order
        </Link>

        <WhatsAppButton orderId={invoice.orderId} phone={invoice.customer.phone} />
      </div>

      {/* Paper. Printed on white, so it is legible on paper and in a photo. */}
      <article className="mt-6 rounded-lg bg-[#F5EDD8] p-8 text-[#1F0705] print:mt-0 print:rounded-none print:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1F0705]/20 pb-5">
          <div>
            <p className="font-heading text-2xl font-bold tracking-tight">{invoice.seller.name}</p>
            {invoice.seller.legalName && <p className="text-sm">{invoice.seller.legalName}</p>}
            <p className="mt-1 max-w-xs text-sm leading-relaxed opacity-80">{invoice.seller.address}</p>
            {invoice.seller.gstin ? (
              <p className="tabular mt-1 text-sm">GSTIN {invoice.seller.gstin}</p>
            ) : (
              <p className="mt-1 text-sm font-semibold">Not GST registered on record</p>
            )}
          </div>

          <div className="text-right">
            <p className="font-heading text-lg font-bold uppercase tracking-[0.08em]">{title}</p>
            <p className="tabular mt-1 text-sm">
              {invoice.invoiceNumber ?? <span className="opacity-70">Issued when paid</span>}
            </p>
            <p className="tabular text-sm opacity-80">{when(invoice.invoicedAt ?? invoice.placedAt)}</p>
            <p className="tabular mt-1 text-sm opacity-80">Order #{invoice.orderNumber}</p>
          </div>
        </header>

        <section className="flex flex-wrap justify-between gap-4 border-b border-[#1F0705]/20 py-5 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] opacity-70">Billed to</p>
            <p className="mt-1 font-semibold">{invoice.customer.name ?? "Walk-in"}</p>
            {invoice.customer.phone && <p className="tabular">{invoice.customer.phone}</p>}
            {invoice.customer.address && <p className="max-w-xs opacity-80">{invoice.customer.address}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] opacity-70">Place of supply</p>
            <p className="tabular mt-1">
              {invoice.seller.state ?? "—"}
              {invoice.seller.stateCode ? ` (${invoice.seller.stateCode})` : ""}
            </p>
            <p className="mt-1 opacity-80">
              {invoice.fulfilment === "DELIVERY" ? "Delivery" : "Collection"}
            </p>
          </div>
        </section>

        <table className="mt-5 w-full border-collapse text-sm">
          <caption className="sr-only">Items on this {title.toLowerCase()}</caption>
          <thead>
            <tr className="border-b border-[#1F0705]/20 text-left">
              <th scope="col" className="pb-2 pr-2 font-semibold">Item</th>
              <th scope="col" className="pb-2 pr-2 text-right font-semibold">HSN</th>
              <th scope="col" className="pb-2 pr-2 text-right font-semibold">Qty</th>
              <th scope="col" className="pb-2 pr-2 text-right font-semibold">Taxable</th>
              <th scope="col" className="pb-2 pr-2 text-right font-semibold">CGST</th>
              <th scope="col" className="pb-2 pr-2 text-right font-semibold">SGST</th>
              <th scope="col" className="pb-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index} className="border-b border-[#1F0705]/10 align-top">
                <td className="py-2 pr-2">
                  {line.name}
                  {line.modifiers.length > 0 && (
                    <span className="block text-xs opacity-70">{line.modifiers.join(", ")}</span>
                  )}
                </td>
                <td className="tabular py-2 pr-2 text-right">{line.hsnCode ?? "—"}</td>
                <td className="tabular py-2 pr-2 text-right">{line.quantity}</td>
                <td className="tabular py-2 pr-2 text-right">{formatINR(line.taxable, "unit")}</td>
                <td className="tabular py-2 pr-2 text-right">
                  {formatINR(line.cgst, "unit")}
                  <span className="block text-xs opacity-60">{formatBps(line.rateBps / 2, 2)}</span>
                </td>
                <td className="tabular py-2 pr-2 text-right">
                  {formatINR(line.sgst, "unit")}
                  <span className="block text-xs opacity-60">{formatBps(line.rateBps / 2, 2)}</span>
                </td>
                <td className="tabular py-2 text-right font-semibold">{formatINR(line.total, "unit")}</td>
              </tr>
            ))}

            {invoice.deliveryFee > 0n && (
              <tr className="border-b border-[#1F0705]/10">
                <td className="py-2 pr-2" colSpan={6}>
                  Delivery
                </td>
                <td className="tabular py-2 text-right font-semibold">{formatINR(invoice.deliveryFee, "unit")}</td>
              </tr>
            )}
          </tbody>
        </table>

        <section className="mt-5 flex justify-end">
          <dl className="w-full max-w-xs text-sm">
            <div className="flex justify-between gap-4 py-1">
              <dt className="opacity-80">Taxable value</dt>
              <dd className="tabular">{formatINR(invoice.taxable, "unit")}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="opacity-80">CGST</dt>
              <dd className="tabular">{formatINR(invoice.cgst, "unit")}</dd>
            </div>
            <div className="flex justify-between gap-4 py-1">
              <dt className="opacity-80">SGST</dt>
              <dd className="tabular">{formatINR(invoice.sgst, "unit")}</dd>
            </div>
            {invoice.igst > 0n && (
              <div className="flex justify-between gap-4 py-1">
                <dt className="opacity-80">IGST</dt>
                <dd className="tabular">{formatINR(invoice.igst, "unit")}</dd>
              </div>
            )}
            <div className="mt-2 flex justify-between gap-4 border-t border-[#1F0705]/30 pt-2">
              <dt className="font-heading text-base font-bold">Total</dt>
              <dd className="tabular font-heading text-base font-bold">{formatINR(invoice.total)}</dd>
            </div>
          </dl>
        </section>

        <footer className="mt-6 border-t border-[#1F0705]/20 pt-4 text-xs leading-relaxed opacity-70">
          <p>Prices include GST. Amounts in Indian rupees.</p>
          {!isTaxInvoice && (
            <p className="mt-1 font-semibold">
              This is a receipt, not a tax invoice — no GSTIN is on record for this business.
            </p>
          )}
        </footer>
      </article>

      <p className="mt-4 text-sm text-muted-foreground print:hidden">
        Use your browser&rsquo;s print to save this as a PDF.
      </p>
    </div>
  );
}
