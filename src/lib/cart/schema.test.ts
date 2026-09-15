/**
 * The cart is a cookie the browser can edit at will, so this schema is a trust
 * boundary rather than a convenience type. These tests cover the two things
 * that makes it responsible for: what a hostile cart cannot smuggle in, and
 * what counts as "the same line".
 *
 * Neither had a test. The module is pure, so there was no reason beyond nobody
 * having written one.
 */

import { describe, expect, it } from "vitest";
import { EMPTY_CART, cartSchema, lineKey } from "./schema";

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

  it("caps the work a single cookie can ask the server to do", () => {
    // Every render prices the whole cart. Without caps a hostile cookie is a
    // free amplification: one request, ten thousand priced lines.
    const line = { slug: "x", quantity: 1, modifiers: [] };
    expect(cartSchema.safeParse({ lines: Array(50).fill(line) }).success).toBe(true);
    expect(cartSchema.safeParse({ lines: Array(51).fill(line) }).success).toBe(false);
  });

  it("caps quantity per line", () => {
    const at = (quantity: number) =>
      cartSchema.safeParse({ lines: [{ slug: "x", quantity, modifiers: [] }] }).success;
    expect(at(50)).toBe(true);
    expect(at(51)).toBe(false);
    expect(at(0)).toBe(false);
    expect(at(-1)).toBe(false);
    expect(at(1.5)).toBe(false);
  });

  it("caps modifiers per line", () => {
    const withModifiers = (count: number) =>
      cartSchema.safeParse({
        lines: [{ slug: "x", quantity: 1, modifiers: Array.from({ length: count }, (_, i) => `m${i}`) }],
      }).success;
    expect(withModifiers(20)).toBe(true);
    expect(withModifiers(21)).toBe(false);
  });

  it("caps points and promo code length", () => {
    expect(cartSchema.safeParse({ lines: [], points: 1_000_000 }).success).toBe(true);
    expect(cartSchema.safeParse({ lines: [], points: 1_000_001 }).success).toBe(false);
    expect(cartSchema.safeParse({ lines: [], points: -1 }).success).toBe(false);
    expect(cartSchema.safeParse({ lines: [], promoCode: "x".repeat(40) }).success).toBe(true);
    expect(cartSchema.safeParse({ lines: [], promoCode: "x".repeat(41) }).success).toBe(false);
  });

  it("treats redeemStamp as an intent that defaults to off", () => {
    const parsed = cartSchema.parse({ lines: [{ slug: "x", quantity: 1 }] });
    expect(parsed.lines[0]?.redeemStamp).toBe(false);
    expect(parsed.lines[0]?.modifiers).toEqual([]);
  });

  it("parses an empty cart, and EMPTY_CART is one", () => {
    expect(cartSchema.parse({}).lines).toEqual([]);
    expect(cartSchema.safeParse(EMPTY_CART).success).toBe(true);
  });
});

describe("lineKey — what counts as the same line", () => {
  it("merges the same item regardless of the order options were tapped", () => {
    expect(lineKey({ slug: "wings", modifiers: ["hot", "large"] })).toBe(
      lineKey({ slug: "wings", modifiers: ["large", "hot"] }),
    );
  });

  it("keeps the same product at different heat as two lines", () => {
    expect(lineKey({ slug: "wings", modifiers: ["hot"] })).not.toBe(
      lineKey({ slug: "wings", modifiers: ["mild"] })
    );
    expect(lineKey({ slug: "wings", modifiers: [] })).not.toBe(
      lineKey({ slug: "wings", modifiers: ["hot"] })
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
    // The regression this file was written for. A `|` join has no escape, so
    // ["a|b"] and ["a","b"] produced one key — and this key decides which line
    // setQuantity sets and which removeLine removes, so a collision edits the
    // wrong line or two at once.
    //
    // Real slugs are [a-z0-9-]+ and cannot contain a separator, so this needs a
    // hand-edited cookie and only damages the sender's own cart. Fixed anyway:
    // the ambiguity costs nothing to remove and the cookie schema deliberately
    // stays permissive.
    expect(lineKey({ slug: "burger", modifiers: ["a|b"] })).not.toBe(
      lineKey({ slug: "burger", modifiers: ["a", "b"] }),
    );
    expect(lineKey({ slug: "a", modifiers: ["b"] })).not.toBe(
      lineKey({ slug: "a|b", modifiers: [] }),
    );
    // Quotes and brackets are escaped rather than ending the encoding.
    expect(lineKey({ slug: '"', modifiers: [] })).not.toBe(lineKey({ slug: "", modifiers: ['"'] }));
  });

  it("is stable for the same input", () => {
    const line = { slug: "burger", modifiers: ["cheese", "bacon"] };
    expect(lineKey(line)).toBe(lineKey(line));
  });
});
