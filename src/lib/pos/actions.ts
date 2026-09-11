"use server";

/**
 * Pricing a draft order from the counter.
 *
 * A Server Action, so this is a public HTTP endpoint however it looks in the
 * source. The counter sends what was tapped — a product slug, a quantity,
 * modifier slugs — never a price and never a total. §13.
 *
 * `orders.create` is re-checked on every call rather than trusted from
 * whatever screen rendered the grid: a permission can be revoked mid-shift,
 * and a hidden button is not authorization. §41.
 */

import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { cartLineSchema } from "@/lib/cart/schema";
import { ZERO, formatINR } from "@/lib/money";
import { priceDraft } from "./pricing";

const draftSchema = z.object({
  lines: z.array(cartLineSchema).max(50),
});

export interface PricedDraftLineView {
  readonly key: string;
  readonly name: string;
  readonly quantity: number;
  readonly modifierNames: readonly string[];
  readonly unitPrice: string;
  readonly lineTotal: string;
}

export interface PriceDraftOk {
  readonly ok: true;
  readonly lines: readonly PricedDraftLineView[];
  readonly itemCount: number;
  readonly subtotal: string;
  readonly taxTotal: string;
  readonly cgst: string;
  readonly sgst: string;
  readonly total: string;
  /** Whether any GST was charged — zero-rated orders don't get a tax line. */
  readonly hasTax: boolean;
  /** Slugs the menu no longer recognises. Shown so nothing is silently dropped. */
  readonly rejected: readonly { slug: string; reason: string }[];
}

export interface PriceDraftFail {
  readonly ok: false;
  readonly error: string;
}

export type PriceDraftResult = PriceDraftOk | PriceDraftFail;

const EMPTY: PriceDraftOk = {
  ok: true,
  lines: [],
  itemCount: 0,
  subtotal: formatINR(ZERO),
  taxTotal: formatINR(ZERO),
  cgst: formatINR(ZERO),
  sgst: formatINR(ZERO),
  total: formatINR(ZERO),
  hasTax: false,
  rejected: [],
};

export async function priceDraftOrder(input: unknown): Promise<PriceDraftResult> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That order could not be priced." };

  try {
    await requirePermission("orders.create");
  } catch (error) {
    if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to build an order." };
    throw error;
  }

  if (parsed.data.lines.length === 0) return EMPTY;

  const draft = await priceDraft(parsed.data.lines);

  return {
    ok: true,
    lines: draft.lines.map((line) => ({
      key: line.key,
      name: line.product.name,
      quantity: line.quantity,
      modifierNames: line.modifiers.map((modifier) => modifier.name),
      unitPrice: formatINR(line.unitPrice),
      lineTotal: formatINR(line.priced.gross),
    })),
    itemCount: draft.itemCount,
    subtotal: formatINR(draft.totals.listed),
    taxTotal: formatINR(draft.totals.total),
    cgst: formatINR(draft.totals.cgst),
    sgst: formatINR(draft.totals.sgst),
    total: formatINR(draft.totals.gross),
    hasTax: draft.totals.total > ZERO,
    rejected: draft.rejected,
  };
}
