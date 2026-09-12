/**
 * How a bulk action reports back. A bulk run is not all-or-nothing — each
 * item is its own repository call with its own ownership check — so the
 * honest result is "how many went through, and why the rest didn't", never
 * a bare failure that hides the four that did save.
 */
export interface BulkOutcome {
  readonly ok: boolean;
  readonly error?: string;
}

export function summariseBulk(total: number, failures: readonly string[]): BulkOutcome {
  if (failures.length === 0) return { ok: true };
  const done = total - failures.length;
  const reasons = [...new Set(failures)].join(" ");
  return { ok: false, error: `${done} of ${total} done. ${failures.length} failed: ${reasons}` };
}
