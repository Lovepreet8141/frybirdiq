/**
 * Known causes for reconciliation findings (IQ-2 R2.6 "Explained-by").
 *
 * An explained finding is still shown, with its amount: a double capture
 * means a customer paid twice, whatever caused it. Explaining only moves it
 * out of the Done-when count and names the card that fixes the cause.
 *
 * Only recon.capture_vs_total has one. Every other rule has none: an invoice
 * gap has no legitimate cause since 4ec0274 (F2), and a gst_lines break is
 * stored data, never the GST export's D9.
 */
import type { CaptureRow, ReconRuleId } from "./rules";

/**
 * When pay-4 (the settle guard that stops a second capture, 6ef57a2) reached
 * production: docs/RELEASES.md row 1, 2026-09-17 10:55 UTC, deploying 5d7ed22,
 * which contains 6ef57a2. A double capture created before it is explained.
 */
export const PAY4_DEPLOYED_AT = new Date("2026-09-17T10:55:00Z");

export const EXPLAINING_CARDS: Readonly<Partial<Record<ReconRuleId, readonly string[]>>> = {
  "recon.capture_vs_total": ["pay-4"],
};

/** The card that explains a capture mismatch, or null when nothing known does. */
export function explainCaptureMismatch(row: Pick<CaptureRow, "captureCount" | "lastCaptureCreatedAt">): string | null {
  return row.captureCount > 1 && row.lastCaptureCreatedAt.getTime() < PAY4_DEPLOYED_AT.getTime() ? "pay-4" : null;
}
