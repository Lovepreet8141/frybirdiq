/**
 * What an order line freezes at the moment of sale. BUILD-PLAN.md §51.
 *
 * "Changing today's menu price must never rewrite yesterday's order." The
 * name, the unit price, the modifier names and deltas, the tax rate, the
 * HSN code and every computed tax figure are copied onto the order rows
 * here — never looked up through a product id later. Pure, so the rule is
 * tested without a database, and shared by the website checkout and the
 * counter so the two cannot drift in what they record.
 */

import type { Paise } from "@/lib/money";
import type { PricedLine } from "@/lib/pricing";

export interface SnapshotProduct {
  /** The catalogue row, kept on the line for reporting (§51: the name and price are still copied, never looked up). */
  readonly id?: string | null;
  readonly name: string;
  readonly taxRateBps: number;
  readonly hsnCode: string | null;
  readonly modifierGroups: readonly { readonly name: string; readonly modifiers: readonly { readonly slug: string }[] }[];
}

export interface SnapshotModifier {
  readonly slug: string;
  readonly name: string;
  readonly priceDelta: Paise;
}

export interface SnapshotLineInput {
  readonly product: SnapshotProduct;
  readonly quantity: number;
  readonly modifiers: readonly SnapshotModifier[];
  /** Listed price of one unit including its modifiers. */
  readonly unitPrice: Paise;
  readonly priced: PricedLine;
}

export interface OrderModifierSnapshot {
  readonly groupName: string;
  readonly modifierName: string;
  readonly priceDelta: Paise;
}

export interface OrderItemSnapshot {
  /** Null when the product was not a catalogue row (the static menu fallback). */
  readonly productId: string | null;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: Paise;
  readonly lineSubtotal: Paise;
  readonly lineDiscount: Paise;
  readonly taxRateBps: number;
  readonly hsnCode: string | null;
  readonly lineTaxable: Paise;
  readonly lineTax: Paise;
  readonly lineTotal: Paise;
  readonly position: number;
  readonly modifiers: readonly OrderModifierSnapshot[];
}

/** The group a modifier was chosen from, by slug — "Options" only when the product no longer names it. */
function groupNameFor(product: SnapshotProduct, slug: string): string {
  return product.modifierGroups.find((group) => group.modifiers.some((modifier) => modifier.slug === slug))?.name ?? "Options";
}

export function snapshotLines(lines: readonly SnapshotLineInput[]): OrderItemSnapshot[] {
  return lines.map((line, position) => ({
    productId: line.product.id ?? null,
    productName: line.product.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineSubtotal: line.priced.listed,
    lineDiscount: line.priced.discount,
    taxRateBps: line.product.taxRateBps,
    hsnCode: line.product.hsnCode,
    lineTaxable: line.priced.taxable,
    lineTax: line.priced.total,
    lineTotal: line.priced.gross,
    position,
    modifiers: line.modifiers.map((modifier) => ({
      groupName: groupNameFor(line.product, modifier.slug),
      modifierName: modifier.name,
      priceDelta: modifier.priceDelta,
    })),
  }));
}
