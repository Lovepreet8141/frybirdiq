/** Display-only formatting for the ported frybird-web homepage — matches its own plain "₹199" style rather than the rest of the app's formatINR (which adds paise/grouping meant for invoices, not a marketing card). */
export function rupees(value: number): string {
  return `₹${value}`;
}
