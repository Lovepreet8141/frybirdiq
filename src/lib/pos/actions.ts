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

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { cartLineSchema } from "@/lib/cart/schema";
import { ZERO, formatINR } from "@/lib/money";
import { findCustomerByPhone } from "@/lib/repositories/customers";
import { getStampConfig } from "@/lib/loyalty/config";
import { getStampAccountState } from "@/lib/repositories/loyalty";
import { type MenuCategory, getMenu } from "@/lib/repositories/menu";
import { placeCounterOrder } from "@/lib/repositories/orders";
import { isOrderPaid, recordCashPayment } from "@/lib/repositories/payments";
import { priceDraft } from "./pricing";
import { changeDue, parseTender } from "./tender";

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
  /** The same total in paise, as a string — for the till's change arithmetic, never for the sale itself. */
  readonly totalPaise: string;
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
  totalPaise: "0",
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
    totalPaise: draft.totals.gross.toString(),
    hasTax: draft.totals.total > ZERO,
    rejected: draft.rejected,
  };
}

/* ---------------------------------- Checkout ---------------------------------- */

const counterOrderSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(50),
  channel: z.enum(["DINE_IN", "TAKEAWAY"]),
  tableId: z.string().uuid().nullable().default(null),
  customerPhone: z.string().regex(/^[6-9]\d{9}$/).nullable().default(null),
  notes: z.string().trim().max(500).optional(),
  /** Minted by the till when the payment sheet opens; the same key on every retry. §17. */
  idempotencyKey: z.string().uuid(),
  cashReceived: z.string().trim().min(1),
});

export type CounterCheckoutResult =
  | {
      readonly ok: true;
      readonly orderId: string;
      readonly orderNumber: string;
      readonly total: string;
      readonly received: string;
      readonly change: string;
      readonly paid: true;
      readonly replayed: boolean;
    }
  | {
      readonly ok: true;
      readonly orderId: string;
      readonly orderNumber: string;
      readonly total: string;
      readonly received: string;
      readonly change: null;
      readonly paid: false;
      readonly paymentError: string;
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly error: string };

/**
 * The till's "Confirm payment": place the order, then take the cash.
 *
 * Two existing calls, in order — `placeCounterOrder` (idempotent on the
 * till's key) then `recordCashPayment` (idempotent on the order) — not a
 * POS-only path. A retry replays the placement and finds the order already
 * paid, which is reported as the success it is. `orders.create` gates
 * placement here; `recordCashPayment` checks `orders.update` for the money
 * itself, so a role that may build orders but not take cash is stopped at
 * the right step with the order still visible as unpaid.
 */
export async function placeCounterOrderAction(input: unknown): Promise<CounterCheckoutResult> {
  const parsed = counterOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That order could not be placed. Check the details and try again." };

  const tendered = parseTender(parsed.data.cashReceived);
  if (tendered === null) return { ok: false, error: "Enter the cash received, like 500 or 499.50." };

  let staff;
  try {
    staff = await requirePermission("orders.create");
  } catch (error) {
    if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to place an order." };
    throw error;
  }

  const placed = await placeCounterOrder({
    orgId: staff.orgId,
    lines: parsed.data.lines,
    channel: parsed.data.channel,
    tableId: parsed.data.tableId,
    customerPhone: parsed.data.customerPhone,
    notes: parsed.data.notes ?? null,
    idempotencyKey: parsed.data.idempotencyKey,
    actorUserId: staff.userId,
    tendered,
  });
  if (!placed.ok) return placed;

  const payment = await recordCashPayment({ orderId: placed.orderId, actorUserId: staff.userId, actorRoles: staff.roles, tendered });
  revalidatePath("/app/orders");
  revalidatePath("/app/pos");

  const base = {
    orderId: placed.orderId,
    orderNumber: placed.orderNumber,
    total: formatINR(placed.total),
    received: formatINR(tendered),
    replayed: placed.replayed,
  };

  if (payment.ok || (placed.replayed && (await isOrderPaid(placed.orderId)))) {
    return { ok: true, ...base, change: formatINR(changeDue(placed.total, tendered) ?? ZERO), paid: true };
  }
  return { ok: true, ...base, change: null, paid: false, paymentError: payment.ok ? "" : payment.error };
}

/**
 * Refreshes the product grid against the same shared menu path everything
 * else reads — not a second menu system, just `getMenu()` polled from a
 * screen that stays open for a whole shift. A change made from the Menu
 * Manager (a price, a photo, someone marking an item sold out) reaches the
 * counter within one poll interval without anyone reloading the tab, the
 * same "channel and price never trusted from the client" rule this file
 * already applies to pricing.
 */
const pollChannelSchema = z.enum(["DINE_IN", "TAKEAWAY"]).nullable().default(null);

export async function pollPosMenu(channel: unknown): Promise<{ ok: true; categories: readonly MenuCategory[] } | { ok: false; error: string }> {
  const parsed = pollChannelSchema.safeParse(channel);
  if (!parsed.success) return { ok: false, error: "That channel isn't valid." };

  try {
    await requirePermission("orders.create");
  } catch (error) {
    if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to view the menu." };
    throw error;
  }

  return { ok: true, categories: await getMenu(parsed.data) };
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
