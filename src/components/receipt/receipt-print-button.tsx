"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog, which is also how a customer saves this as a PDF. */
export function ReceiptPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[var(--red-ink)] px-4 text-sm font-semibold text-[var(--cream)] transition-colors hover:bg-[var(--red-deep)]"
    >
      <Printer className="size-4" aria-hidden="true" />
      Save as PDF
    </button>
  );
}
