/**
 * Tax invoice numbering.
 *
 * A GST invoice number must be unique and sequential within the financial
 * year, and the Indian financial year runs 1 April to 31 March — so an order
 * placed on 31 March and one placed the next day belong to different series.
 *
 * Pure, so the rule is testable without a database.
 */

/** FRYBIRD trades in Ambala; the financial year turns at midnight there. */
const BUSINESS_TIMEZONE = "Asia/Kolkata";

/**
 * The calendar year and month of a moment, in the business's own timezone.
 *
 * `getFullYear()` and `getMonth()` read the *server's* timezone. On a VPS set
 * to UTC, midnight on 1 April in Ambala is still 31 March — so an invoice
 * issued in the first five and a half hours of a new financial year would be
 * filed into the old one. That breaks once a year, silently, and leaves the
 * numbering non-sequential in exactly the way GST requires it not to be.
 */
function businessParts(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, month };
}

/** The financial year a date falls in, as "2026-27". */
export function financialYear(date: Date): string {
  const { year, month } = businessParts(date);
  // January, February and March belong to the year that began the previous
  // April. Getting this wrong restarts the series three months early.
  const startYear = month < 4 ? year - 1 : year;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Formats a sequence number within a financial year. */
export function invoiceNumber(date: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`invoice: ${sequence} is not a sequence number`);
  }
  return `${financialYear(date)}/${String(sequence).padStart(4, "0")}`;
}

/** Reads a number back, for finding the highest issued so far. */
export function parseInvoiceNumber(value: string): { financialYear: string; sequence: number } | null {
  const match = /^(\d{4}-\d{2})\/(\d+)$/.exec(value);
  if (!match) return null;
  return { financialYear: match[1]!, sequence: Number(match[2]) };
}
