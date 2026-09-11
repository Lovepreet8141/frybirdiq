"use server";

/**
 * Cart mutations.
 *
 * Server Actions, so the cart cookie is written on the server and the client
 * never computes a price. Each action validates its input with Zod before
 * touching the cart — §3 requires a schema at every boundary, and a Server
 * Action is a public HTTP endpoint however it looks in the source.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProduct } from "@/lib/repositories/menu";
import { readCart, writeCart } from "./index";
import { type CartLine, cartLineSchema, lineKey } from "./schema";
import { normaliseCode } from "@/lib/promotions";

export interface CartActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly itemCount?: number;
}

function countItems(lines: readonly CartLine[]): number {
  return lines.reduce((count, line) => count + line.quantity, 0);
}

export async function addToCart(input: unknown): Promise<CartActionResult> {
  const parsed = cartLineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That item could not be added." };

  const product = await getProduct(parsed.data.slug, "ONLINE");
  if (!product) return { ok: false, error: "That item is no longer on the menu." };

  // Every required group must be answered, and no group may be over-filled.
  // The client shows the same rules; this is the one that counts.
  for (const group of product.modifierGroups) {
    const chosen = group.modifiers.filter((modifier) => parsed.data.modifiers.includes(modifier.slug));
    if (chosen.length < group.minSelections) {
      return { ok: false, error: `Choose a ${group.name.toLowerCase()}.` };
    }
    if (group.maxSelections !== null && chosen.length > group.maxSelections) {
      return { ok: false, error: `Too many choices for ${group.name.toLowerCase()}.` };
    }
  }

  // Drop anything that is not a real modifier of this product, rather than
  // storing a slug that will be silently ignored at pricing time.
  const valid = new Set(product.modifierGroups.flatMap((group) => group.modifiers.map((modifier) => modifier.slug)));
  const line: CartLine = {
    slug: parsed.data.slug,
    quantity: parsed.data.quantity,
    modifiers: parsed.data.modifiers.filter((slug) => valid.has(slug)),
    // A fresh add is never itself the redemption — that is a separate,
    // explicit choice made afterwards. See setRedeemReward.
    redeemStamp: false,
  };

  const cart = await readCart();
  const key = lineKey(line);
  const existing = cart.lines.find((candidate) => lineKey(candidate) === key);

  const lines = existing
    ? cart.lines.map((candidate) =>
        lineKey(candidate) === key
          ? { ...candidate, quantity: Math.min(candidate.quantity + line.quantity, 50) }
          : candidate,
      )
    : [...cart.lines, line];

  if (lines.length > 50) return { ok: false, error: "That is as much as one order can hold." };

  await writeCart({ ...cart, lines });
  revalidatePath("/", "layout");
  return { ok: true, itemCount: countItems(lines) };
}

const quantitySchema = z.object({ key: z.string().min(1), quantity: z.number().int().min(0).max(50) });

/** Setting a quantity to zero removes the line. */
export async function setQuantity(input: unknown): Promise<CartActionResult> {
  const parsed = quantitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That change could not be applied." };

  const cart = await readCart();
  const lines = cart.lines
    .map((line) => (lineKey(line) === parsed.data.key ? { ...line, quantity: parsed.data.quantity } : line))
    .filter((line) => line.quantity > 0);

  await writeCart({ ...cart, lines });
  revalidatePath("/", "layout");
  return { ok: true, itemCount: countItems(lines) };
}

export async function removeLine(input: unknown): Promise<CartActionResult> {
  const parsed = z.object({ key: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That item could not be removed." };

  const cart = await readCart();
  const lines = cart.lines.filter((line) => lineKey(line) !== parsed.data.key);

  await writeCart({ ...cart, lines });
  revalidatePath("/", "layout");
  return { ok: true, itemCount: countItems(lines) };
}

export async function clearCart(): Promise<CartActionResult> {
  await writeCart({ lines: [] });
  revalidatePath("/", "layout");
  return { ok: true, itemCount: 0 };
}

/**
 * Applies a promotion code.
 *
 * Stores only the code. What it is worth is decided by the server every time
 * the cart is priced, so a code that expires between adding it and checking
 * out stops applying by itself.
 */
export async function applyPromoCode(input: unknown): Promise<CartActionResult> {
  const parsed = z.object({ code: z.string().max(40) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That code could not be applied." };

  const cart = await readCart();
  await writeCart({ ...cart, promoCode: normaliseCode(parsed.data.code) || undefined });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearPromoCode(): Promise<CartActionResult> {
  const cart = await readCart();
  await writeCart({ ...cart, promoCode: undefined });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Marks one line as "my FRYBIRD REWARDS free item" — or clears it.
 *
 * At most one line carries the flag at a time: choosing a new one replaces
 * whatever was chosen before rather than stacking. Whether it is actually
 * honoured — an available reward, a price within the cap — is decided by
 * `priceCart` every time the cart is read, never here. This action only
 * records the customer's choice.
 */
export async function setRedeemReward(input: unknown): Promise<CartActionResult> {
  const parsed = z.object({ key: z.string().min(1), redeem: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That could not be applied." };

  const cart = await readCart();
  const lines = cart.lines.map((line) => ({
    ...line,
    redeemStamp: lineKey(line) === parsed.data.key ? parsed.data.redeem : false,
  }));

  await writeCart({ ...cart, lines });
  revalidatePath("/", "layout");
  return { ok: true, itemCount: countItems(lines) };
}

/**
 * Sets how many points to spend.
 *
 * The number is an intent, not a discount: the server caps it at the balance
 * and at the order total when it prices the cart, so a tampered cookie asking
 * for a million points spends whatever is actually there and no more.
 */
export async function setPointsToSpend(input: unknown): Promise<CartActionResult> {
  const parsed = z.object({ points: z.number().int().min(0).max(1_000_000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That could not be applied." };

  const cart = await readCart();
  await writeCart({ ...cart, points: parsed.data.points || undefined });
  revalidatePath("/", "layout");
  return { ok: true };
}
