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

  const product = await getProduct(parsed.data.slug);
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

  await writeCart({ lines });
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

  await writeCart({ lines });
  revalidatePath("/", "layout");
  return { ok: true, itemCount: countItems(lines) };
}

export async function removeLine(input: unknown): Promise<CartActionResult> {
  const parsed = z.object({ key: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That item could not be removed." };

  const cart = await readCart();
  const lines = cart.lines.filter((line) => lineKey(line) !== parsed.data.key);

  await writeCart({ lines });
  revalidatePath("/", "layout");
  return { ok: true, itemCount: countItems(lines) };
}

export async function clearCart(): Promise<CartActionResult> {
  await writeCart({ lines: [] });
  revalidatePath("/", "layout");
  return { ok: true, itemCount: 0 };
}
