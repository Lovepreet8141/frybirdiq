/**
 * The one way to mint an `Observed` quantity.
 *
 * DESIGN-v2-DELTA.md §1: a figure is Observed only when it was read from
 * stored rows, so only the repository readers (`src/lib/repositories/iq-*.ts`)
 * and this module's test may import this file. The lint rule that enforces it
 * belongs to QA (slice S9). Everything else receives Observed values from
 * those readers, or from parsing a stored insight with `InsightSchema`.
 */
import { ObservedSchema, type Observed, type Quantity } from "./quantity";

export function observed(quantity: Quantity): Observed {
  return ObservedSchema.parse(quantity);
}

/** An observed money figure from a `bigint` paise column. */
export function observedPaise(amount: bigint): Observed {
  return observed({ unit: "paise", value: amount.toString() });
}
