/**
 * Opening-hours rule for the business profile.
 *
 * FRYBIRD trades within one calendar day. Overnight hours (closing at or
 * before opening, e.g. 18:00–02:00) would split one night's takings across
 * two business dates: `orders.business_date` splits at IST midnight and every
 * revenue figure buckets on it, so the owner's "yesterday" would show half a
 * night and closing cash would never match one day's sales — with no error
 * anywhere. Supporting them needs a trading-day concept separate from the
 * business date — card td-1. Until then this is refused deliberately, not
 * incidentally. The hours predicates (`openHoursSpan`, `businessHoursWindow`,
 * `isOpenAt`) still support overnight spans; this refuses the input, it does
 * not remove the capability.
 */

/** "HH:MM" 24-hour strings compare correctly as text. Returns an error message, or null when the hours are acceptable. */
export function overnightHoursError(openingTime: string, closingTime: string): string | null {
  if (closingTime > openingTime) return null;
  return closingTime === openingTime
    ? "Opening and closing time can't be the same."
    : "Closing time must be after opening time. FRYBIRD's sales are reported one calendar day at a time, so overnight hours would split one night's takings across two days in every report. They aren't supported yet.";
}
