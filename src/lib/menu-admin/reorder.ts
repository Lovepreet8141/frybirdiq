/**
 * The one swap algorithm behind every "move up / move down" in the Menu
 * Manager — categories, products within a category, options within a
 * modifier group. Pure: takes the siblings in their current display order
 * and returns the position writes that put the moved row one step over.
 *
 * Returns writes for every row whose stored position no longer matches its
 * place in the new order, not just the two neighbours. For rows that are
 * already 0..n-1 that is exactly two writes. For legacy rows that all sit
 * at position 0, or rows with gaps left by deletes, it also normalises the
 * run — otherwise swapping "0" with "0" would persist nothing and the move
 * would silently not happen.
 */
export interface Positioned {
  readonly id: string;
  readonly position: number;
}

export interface PositionWrite {
  readonly id: string;
  readonly position: number;
}

export function planSwap<T extends Positioned>(siblings: readonly T[], id: string, direction: "up" | "down"): readonly PositionWrite[] | null {
  const index = siblings.findIndex((row) => row.id === id);
  if (index === -1) return null;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= siblings.length) return null;

  const order = [...siblings];
  [order[index], order[swapWith]] = [order[swapWith]!, order[index]!];

  return order.flatMap((row, position) => (row.position === position ? [] : [{ id: row.id, position }]));
}
