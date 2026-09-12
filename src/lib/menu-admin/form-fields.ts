/**
 * Zod fields for the shapes an HTML form actually posts — pure, so the
 * rules can be unit-tested away from the "use server" actions that use them.
 *
 * An unticked checkbox is simply absent from FormData; a ticked one is
 * "on". Under zod 3, `z.coerce.boolean()` read the absent key as `false`.
 * Zod 4 refuses a missing key outright ("expected nonoptional, received
 * undefined"), which silently broke every form with an unticked box: a
 * non-vegetarian product's details would not save, and a modifier option
 * could only be added if it was marked as the default. These fields make
 * the form's real behaviour the contract.
 */

import { z } from "zod";

/** Absent or "" → false; "on"/"true" → true. Never `Boolean("false")`. */
export const checkbox = z
  .string()
  .optional()
  .transform((value) => value === "on" || value === "true");

/**
 * A number input the user may leave blank. Blank stays `""` (the caller
 * stores null) instead of coercing to 0 — "no prep time set" and "zero
 * minutes" are different facts.
 */
export function optionalInt(min: number, max: number) {
  return z.literal("").or(z.coerce.number().int().min(min).max(max)).optional();
}
