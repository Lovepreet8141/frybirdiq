/**
 * What the ingredient list can say needs a look, from master data alone:
 * no price yet, a price that has gone stale, no usual supplier. Nothing
 * here reads stock, waste or purchasing — those ledgers are not connected
 * yet, and this file must not pretend otherwise.
 */

export const STALE_PRICE_DAYS = 30;

export type AttentionKind = "unpriced" | "stale-price" | "no-supplier";

export interface AttentionInput {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly costPerBaseUnit: bigint;
  readonly lastPricedAt: Date | null;
  readonly supplierName: string | null;
}

export interface AttentionItem {
  readonly kind: AttentionKind;
  readonly ingredientId: string;
  readonly name: string;
  readonly detail: string;
}

const DAY_MS = 86_400_000;

export function daysSince(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

/** Active ingredients only; an inactive one is not bought, so its price cannot go stale. Unpriced first, then the oldest prices, then missing suppliers. */
export function inventoryAttention(rows: readonly AttentionInput[], now: Date): readonly AttentionItem[] {
  const active = rows.filter((row) => row.isActive);

  const unpriced: AttentionItem[] = active
    .filter((row) => row.costPerBaseUnit === 0n)
    .map((row) => ({ kind: "unpriced", ingredientId: row.id, name: row.name, detail: "No price recorded, so nothing that uses it can be costed" }));

  const stale: AttentionItem[] = active
    .filter((row) => row.costPerBaseUnit !== 0n && row.lastPricedAt !== null && daysSince(row.lastPricedAt, now) >= STALE_PRICE_DAYS)
    .sort((a, b) => (a.lastPricedAt as Date).getTime() - (b.lastPricedAt as Date).getTime())
    .map((row) => {
      const days = daysSince(row.lastPricedAt as Date, now);
      return { kind: "stale-price", ingredientId: row.id, name: row.name, detail: `Last priced ${days} days ago` };
    });

  const noSupplier: AttentionItem[] = active
    .filter((row) => row.supplierName === null)
    .map((row) => ({ kind: "no-supplier", ingredientId: row.id, name: row.name, detail: "No usual supplier on record" }));

  return [...unpriced, ...stale, ...noSupplier];
}
