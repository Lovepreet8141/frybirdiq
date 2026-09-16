/**
 * Whether tapping a product at the counter should stop for a choice, or add
 * it straight to the order.
 *
 * The counter is not the website: a sauce or add-on the customer could take
 * or leave (minSelections 0) doesn't need a cashier's attention, but a group
 * the customer must choose from (minSelections > 0 — a size, a spice level)
 * still does, the same as it always has. §33's "required" is this same
 * field, already used by the modifier picker itself to gate submission.
 */
export function needsPosModifierPicker(modifierGroups: readonly { readonly minSelections: number }[]): boolean {
  return modifierGroups.some((group) => group.minSelections > 0);
}
