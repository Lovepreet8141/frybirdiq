/**
 * CSV — the one place this app builds a comma-separated file.
 *
 * No library. A CSV row is `csvCell` joined by commas, and the whole
 * document is rows joined by newlines; pulling in a dependency for that
 * would be trading four lines of code even scripts/export-customers.ts
 * already had right for a package to audit and keep current. This module is
 * that same escaper, pulled out so every export — the marketing list script
 * and the reports.export downloads (roadmap 5.4) — reads from one place
 * instead of two copies quietly drifting.
 *
 * Pure. No DB, no Next, nothing server-only — it runs the same inside a
 * route handler and inside a `tsx` script.
 */

/** One cell, comma/quote/newline-safe. Numbers and null pass through as text. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A full CSV document: a header row, then one row per record.
 *
 * Joined with CRLF — Excel's own line ending, and harmless everywhere else —
 * so a file opened on Windows does not show every row run together. Ends
 * with a trailing line, the POSIX-friendly convention `csvCell`'s own
 * newline-escaping already assumes.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const lines = [header.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}
