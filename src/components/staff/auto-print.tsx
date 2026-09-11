"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/**
 * Triggers the print dialog once the ticket has painted, and offers a manual
 * retry — the tab this opened in has no other chrome to press.
 *
 * A short delay rather than calling `print()` synchronously on mount: the
 * browser needs a frame to lay out the page first, or a slow device can open
 * the dialog against a still-blank sheet.
 */
export function AutoPrint() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="fixed right-4 top-4 flex min-h-[44px] items-center gap-2 rounded-md border border-black/15 bg-white px-4 text-sm font-semibold text-black shadow-md print:hidden"
    >
      <Printer className="size-4" aria-hidden="true" />
      Print again
    </button>
  );
}
