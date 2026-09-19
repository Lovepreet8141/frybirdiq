import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { ArrowLeft } from "lucide-react";
import { FrybirdReceipt } from "@/components/receipt/frybird-receipt";
import { ReceiptPrintButton } from "@/components/receipt/receipt-print-button";
import { ReceiptShare } from "@/components/receipt/receipt-share";
import { getCustomerReceipt } from "@/lib/receipt/customer-view";
import { channelThankYouMessage } from "@/lib/receipt/share-message";
import { getCustomer } from "@/lib/customer";
import { readRememberedContact } from "@/lib/cart/remembered-contact";
import { redactReceiptCustomerForViewer, viewerOwnsOrder } from "@/components/order/viewer-owns-order";

export const metadata: Metadata = { title: "Receipt", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The customer-facing receipt. Same URL as before — `/order/[id]/invoice` —
 * kept stable for links already sent (WhatsApp, SMS, email) and for search
 * engines that may have crawled it despite `robots`; only what renders at it
 * has changed.
 *
 * Authorization is unchanged from before this feature: the order id is an
 * unguessable UUID and its possession is what this whole site's order pages
 * treat as access, the same as `/order/[id]` itself. Nothing here weakens or
 * broadens that — no new capability is added.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A mangled link is not a uuid; querying a uuid column with it throws (a 500), so it is a 404 here.
  if (!isUuid(id)) notFound();
  const [receipt, customer, remembered] = await Promise.all([getCustomerReceipt(id), getCustomer(), readRememberedContact()]);
  if (!receipt) notFound();

  // Same rule as /order/[id]: the link alone does not prove the viewer is the
  // customer, so their name and phone are withheld from anyone else. The
  // invoice never carries an email, so only phone decides this here.
  const isOwner = viewerOwnsOrder({ customerPhone: receipt.customer.phone, customerEmail: null }, customer, remembered);
  const receiptData = { ...receipt, customer: redactReceiptCustomerForViewer(receipt.customer, isOwner) };

  return (
    <div className="mx-auto w-full max-w-2xl px-[var(--gutter)] py-10 print:max-w-none print:px-0 print:py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/order/${receipt.orderId}`}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Order
        </Link>

        <div className="flex items-center gap-2">
          <ReceiptPrintButton />
        </div>
      </div>

      <ReceiptShare
        filename={`FRYBIRD-Order-${receipt.orderNumber}-Invoice.jpg`}
        message={channelThankYouMessage(receipt.fulfilment)}
        orderId={receipt.orderId}
        phone={isOwner ? receipt.customer.phone : null}
      >
        <div className="mt-6 print:mt-0">
          <FrybirdReceipt data={receiptData} />
        </div>
      </ReceiptShare>

      <p className="mt-4 text-center text-sm text-muted-foreground print:hidden">Save as PDF above, or use your browser&rsquo;s print.</p>
    </div>
  );
}
