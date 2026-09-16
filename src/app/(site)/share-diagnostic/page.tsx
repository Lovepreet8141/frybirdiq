import type { Metadata } from "next";
import { ShareDiagnosticTest } from "@/components/receipt/share-diagnostic-test";

export const metadata: Metadata = { title: "Share diagnostic", robots: { index: false, follow: false } };

/**
 * TEMPORARY — for the Web Share/WhatsApp image-attachment investigation
 * only. No order or customer data: generates a tiny synthetic image
 * on-device and runs the same canShare/share calls the real invoice button
 * uses, so its result can be compared against the real invoice on the same
 * phone. Delete this route once the investigation concludes.
 */
export default function ShareDiagnosticPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-[var(--gutter)] py-10">
      <h1 className="font-heading text-2xl font-bold">Share diagnostic (temporary)</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tests navigator.share with a tiny known-good image, independent of the real invoice, to isolate where the Web
        Share flow is failing.
      </p>
      <div className="mt-6">
        <ShareDiagnosticTest />
      </div>
    </div>
  );
}
