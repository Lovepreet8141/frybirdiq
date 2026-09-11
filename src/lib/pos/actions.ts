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
import { findCustomerByPhone } from "@/lib/repositories/customers";
import { getStampConfig } from "@/lib/loyalty/config";
import { getStampAccountState } from "@/lib/repositories/loyalty";
import { priceDraft } from "./pricing";

const draftSchema = z.object({
  lines: z.array(cartLineSchema).max(50),
  channel: z.enum(["DINE_IN", "TAKEAWAY"]).nullable().default(null),
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

  const draft = await priceDraft(parsed.data.lines, parsed.data.channel);

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

export interface CustomerLookupResult {
  readonly ok: true;
  readonly name: string | null;
  readonly phone: string;
  /** null when the stamp program is off, or this customer has never earned toward it. */
  readonly rewards: { readonly stampCount: number; readonly stampsRequired: number; readonly availableRewardCount: number } | null;
}

export interface CustomerLookupFail {
  readonly ok: false;
  readonly error: string;
}

const phoneSchema = z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number.");

/**
 * Looks a customer up by phone for the counter — read-only, no discount is
 * applied here. Reuses the same FRYBIRD REWARDS ledger the website reads
 * (`getStampAccountState`), not a parallel POS loyalty system.
 */
export async function lookupCustomerAction(phone: string): Promise<CustomerLookupResult | CustomerLookupFail> {
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a 10-digit mobile number." };

  let staff;
  try {
    staff = await requirePermission("customers.view");
  } catch (error) {
    if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to look up customers." };
    throw error;
  }

  const customer = await findCustomerByPhone(staff.orgId, parsed.data);
  if (!customer) return { ok: false, error: "No customer found with that number." };

  const config = await getStampConfig();
  const state = config.enabled ? await getStampAccountState(customer.id, staff.orgId) : null;

  return {
    ok: true,
    name: customer.name,
    phone: parsed.data,
    rewards: state ? { stampCount: state.stampCount, stampsRequired: config.stampsRequired, availableRewardCount: state.availableRewards.length } : null,
  };
}
