"use client";

import { makeSyntheticTestFile } from "@/lib/receipt/share-image";
import { ShareExperiment } from "./share-experiment";

/**
 * TEMPORARY, standalone diagnostic — no order/customer data touched at all.
 * Generates a tiny, known-good synthetic image (drawn locally, not the
 * invoice) and runs the exact same canShare/share calls the real invoice
 * share button uses, so its result can be compared against the real
 * invoice's result on the same device: if this tiny file shares
 * successfully but the invoice doesn't, the problem is specific to the
 * generated invoice file; if both fail the same way, it's the device/
 * browser/WhatsApp combination, not anything FRYBIRD IQ generates.
 *
 * Meant to be deleted once the Web Share investigation concludes.
 */
export function ShareDiagnosticTest() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground break-all">
        User agent: {typeof navigator !== "undefined" ? navigator.userAgent : "—"}
      </p>
      <ShareExperiment label="TEST JPEG" autoRun generate={() => makeSyntheticTestFile("image/jpeg", "test.jpg")} />
      <ShareExperiment label="TEST PNG" autoRun generate={() => makeSyntheticTestFile("image/png", "test.png")} />
    </div>
  );
}
