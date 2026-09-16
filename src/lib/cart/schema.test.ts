/**
 * The cart is a cookie the browser can edit at will, so this schema is a
 * trust boundary rather than a convenience type. These tests cover what that
 * boundary is responsible for: what a hostile cart cannot smuggle in or
 * overload the server with, and what counts as "the same line".
 */

import { describe, expect, it } from "vitest";

import { EMPTY_CART, cartLineSchema, cartSchema, ensureCartIdempotencyKey, lineKey } from "./schema";

describe("cartLineSchema — the trust boundary on a cookie the browser can edit", () => {
  it("accepts a well-formed line", () => {
    const result = cartLineSchema.safeParse({ slug: "nashville-burger", quantity: 2, modifiers: ["extra-spicy"] });
    expect(result.success).toBe(true);
  });

  it("defaults modifiers to empty and redeemStamp to false", () => {
    const result = cartLineSchema.parse({ slug: "wings-6pc", quantity: 1 });
    expect(result.modifiers).toEqual([]);
    expect(result.redeemStamp).toBe(false);
  });

  it("refuses a quantity of zero or below — a line with nothing on it is not a line", () => {
    expect(cartLineSchema.safeParse({ slug: "wings-6pc", quantity: 0 }).success).toBe(false);
    expect(cartLineSchema.safeParse({ slug: "wings-6pc", quantity: -1 }).success).toBe(false);
  });

  it("caps a single line's quantity at 50, so a forged cookie cannot order an uncapped amount", () => {
    expect(cartLineSchema.safeParse({ slug: "wings-6pc", quantity: 50 }).success).toBe(true);
    expect(cartLineSchema.safeParse({ slug: "wings-6pc", quantity: 51 }).success).toBe(false);
  });

  it("refuses a fractional quantity", () => {
    expect(cartLineSchema.safeParse({ slug: "wings-6pc", quantity: 1.5 }).success).toBe(false);
  });

  it("refuses an empty slug", () => {
    expect(cartLineSchema.safeParse({ slug: "", quantity: 1 }).success).toBe(false);
  });

  it("caps the modifier count so a forged cookie cannot balloon the price computation", () => {
    const modifiers = Array.from({ length: 21 }, (_, i) => `mod-${i}`);
    expect(cartLineSchema.safeParse({ slug: "wings-6pc", quantity: 1, modifiers }).success).toBe(false);
  });
});

describe("cartSchema — what a forged cookie cannot do", () => {
  it("drops a price the client tried to put in the cart", () => {
    // The module's own rule: "If a price ever appears in this schema, the cart
    // has become forgeable." Zod strips unknown keys, so the guarantee holds —
    // this pins it, because switching to .passthrough() somewhere would quietly
    // end it.
    const parsed = cartSchema.parse({
      lines: [{ slug: "crispy-burger", quantity: 1, modifiers: [], price: 1, total: 1 }],
      subtotal: 0,
      discount: 999_999,
    });

    expect(parsed).not.toHaveProperty("subtotal");
    expect(parsed).not.toHaveProperty("discount");
    expect(parsed.lines[0]).not.toHaveProperty("price");
    expect(parsed.lines[0]).not.toHaveProperty("total");
  });

  it("defaults to an empty line list", () => {
    expect(cartSchema.parse({})).toEqual(EMPTY_CART);
  });

  it("caps the number of lines, so a hostile cookie cannot make the server price thousands of lines", () => {
    const lines = Array.from({ length: 51 }, (_, i) => ({ slug: `product-${i}`, quantity: 1 }));
    expect(cartSchema.safeParse({ lines }).success).toBe(false);
    expect(cartSchema.safeParse({ lines: lines.slice(0, 50) }).success).toBe(true);
  });

  it("caps redeemable points and refuses a fractional or negative amount", () => {
    expect(cartSchema.safeParse({ points: 1_000_000 }).success).toBe(true);
    expect(cartSchema.safeParse({ points: 1_000_001 }).success).toBe(false);
    expect(cartSchema.safeParse({ points: -1 }).success).toBe(false);
    expect(cartSchema.safeParse({ points: 12.5 }).success).toBe(false);
  });

  it("caps the promo code length", () => {
    expect(cartSchema.safeParse({ lines: [], promoCode: "x".repeat(40) }).success).toBe(true);
    expect(cartSchema.safeParse({ lines: [], promoCode: "x".repeat(41) }).success).toBe(false);
  });
});

describe("lineKey — identity for merging, not pricing", () => {
  it("gives the same key to the same line, regardless of the order modifiers were tapped in", () => {
    const a = lineKey({ slug: "wings-6pc", modifiers: ["extra-spicy", "no-dip"] });
    const b = lineKey({ slug: "wings-6pc", modifiers: ["no-dip", "extra-spicy"] });
    expect(a).toBe(b);
  });

  it("gives a different key to a different product", () => {
    expect(lineKey({ slug: "wings-6pc", modifiers: [] })).not.toBe(lineKey({ slug: "wings-12pc", modifiers: [] }));
  });

  it("gives a different key to the same product with different modifiers", () => {
    expect(lineKey({ slug: "wings-6pc", modifiers: ["extra-spicy"] })).not.toBe(
      lineKey({ slug: "wings-6pc", modifiers: [] }),
    );
  });

  it("does not sort the original array in place", () => {
    // A key function that mutates its input would reorder the customer's cart
    // as a side effect of rendering it.
    const modifiers = ["large", "hot"];
    lineKey({ slug: "wings", modifiers });
    expect(modifiers).toEqual(["large", "hot"]);
  });

  it("cannot be made to collide by a separator in a modifier", () => {
    // The regression this was written for. A `|` join has no escape, so
    // ["a|b"] and ["a","b"] produced one key — and this key decides which
    // line setQuantity sets and which removeLine removes, so a collision
    // edits the wrong line or two at once.
    //
    // Real slugs are [a-z0-9-]+ and cannot contain a separator, so this needed
    // a hand-edited cookie and only damaged the sender's own cart — but the
    // ambiguity cost nothing to remove, so it's removed rather than merely
    // documented.
    expect(lineKey({ slug: "burger", modifiers: ["a|b"] })).not.toBe(lineKey({ slug: "burger", modifiers: ["a", "b"] }));
    expect(lineKey({ slug: "a", modifiers: ["b"] })).not.toBe(lineKey({ slug: "a|b", modifiers: [] }));
    // Quotes and brackets are escaped rather than ending the encoding.
    expect(lineKey({ slug: '"', modifiers: [] })).not.toBe(lineKey({ slug: "", modifiers: ['"'] }));
  });

  it("is stable for the same input", () => {
    const line = { slug: "burger", modifiers: ["cheese", "bacon"] };
    expect(lineKey(line)).toBe(lineKey(line));
  });
});

describe("ensureCartIdempotencyKey — checkout surviving a reload without risking a second order", () => {
  const line = { slug: "wings-6pc", quantity: 1, modifiers: [], redeemStamp: false };

  it("assigns a key to a cart that has a line but none yet", () => {
    const result = ensureCartIdempotencyKey({ lines: [line] });
    expect(result.idempotencyKey).toBeDefined();
    expect(typeof result.idempotencyKey).toBe("string");
  });

  it("never assigns a key to an empty cart — writeCart deletes that cookie entirely", () => {
    expect(ensureCartIdempotencyKey(EMPTY_CART).idempotencyKey).toBeUndefined();
    expect(ensureCartIdempotencyKey({ lines: [] }).idempotencyKey).toBeUndefined();
  });

  it("is the regression test for the actual bug: the SAME key survives repeated calls, unlike a per-render randomUUID()", () => {
    // This is the exact scenario a checkout-page reload used to fail: the old
    // code minted `randomUUID()` fresh on every render, so a lost-response
    // resubmission carried a *different* key than the attempt that may have
    // already succeeded, and withIdempotency saw two unrelated requests
    // instead of one replay.
    const withKey = ensureCartIdempotencyKey({ lines: [line] });
    const key = withKey.idempotencyKey;
    // Every subsequent write (add another item, apply a promo code, change
    // points to spend — anything that spreads the cart it read) must carry
    // the identical key forward, not mint a new one.
    expect(ensureCartIdempotencyKey(withKey).idempotencyKey).toBe(key);
    expect(ensureCartIdempotencyKey({ ...withKey, promoCode: "WELCOME10" }).idempotencyKey).toBe(key);
    expect(ensureCartIdempotencyKey({ ...withKey, lines: [line, { ...line, slug: "nashville-burger" }] }).idempotencyKey).toBe(key);
  });

  it("gives two different carts two different keys — this is per-cart durability, not a global constant", () => {
    const a = ensureCartIdempotencyKey({ lines: [line] });
    const b = ensureCartIdempotencyKey({ lines: [line] });
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it("does not mutate its input", () => {
    const cart = { lines: [line] };
    ensureCartIdempotencyKey(cart);
    expect(cart).toEqual({ lines: [line] });
  });
});

describe("cartSchema — idempotencyKey", () => {
  it("accepts a well-formed cart with a key", () => {
    const result = cartSchema.safeParse({ lines: [{ slug: "wings-6pc", quantity: 1 }], idempotencyKey: "550e8400-e29b-41d4-a716-446655440000" });
    expect(result.success).toBe(true);
  });

  it("treats a missing key as undefined — a legacy cart cookie predating this field must not fail to parse", () => {
    const result = cartSchema.parse({ lines: [{ slug: "wings-6pc", quantity: 1 }] });
    expect(result.idempotencyKey).toBeUndefined();
  });

  it("refuses a non-UUID key rather than silently accepting an arbitrary string a tampered cookie could set", () => {
    const result = cartSchema.safeParse({ lines: [], idempotencyKey: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});
