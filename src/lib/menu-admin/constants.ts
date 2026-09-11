/**
 * Plain constants shared between Server Actions and the client components
 * that call them.
 *
 * Kept out of `actions.ts` on purpose — that file has `"use server"` at the
 * top, and Next only allows a `"use server"` module to export async
 * functions. A `const` array export (even one only ever used for its
 * values, never called) breaks the build with "can only export async
 * functions, found object."
 */

/**
 * Channel values the availability/visibility forms accept.
 *
 * The first three are real `OrderChannel` values. KIOSK/SWIGGY/ZOMATO are
 * menu-*visibility* only — see `product_availability.channel`'s own
 * comment: this column has always been loose text specifically so a
 * marketplace name can be recorded here (Menu Manager can start hiding a
 * category from "Zomato" ahead of time) without that name ever becoming an
 * order channel — `src/domain/order-channel.ts` stays closed to the three
 * real ones until an aggregator integration actually exists.
 */
export const MENU_VISIBILITY_CHANNELS = ["DINE_IN", "TAKEAWAY", "ONLINE", "KIOSK", "SWIGGY", "ZOMATO"] as const;

/** The preset reasons the "mark unavailable" quick action offers — free text is still accepted via "Other". */
export const UNAVAILABLE_REASON_PRESETS = ["Sold out", "Ingredient unavailable", "Kitchen issue", "Temporarily unavailable", "Other"] as const;

/** The auto-reactivation presets the quick action offers. */
export const REACTIVATION_PRESETS = ["2h", "4h", "tomorrow", "custom", "indefinite"] as const;
export type ReactivationPreset = (typeof REACTIVATION_PRESETS)[number];
