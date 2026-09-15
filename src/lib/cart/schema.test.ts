import { describe, expect, it } from "vitest";

import { EMPTY_CART, cartLineSchema, cartSchema, lineKey } from "./schema";

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

describe("cartSchema", () => {
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

  // Not asserted here: lineKey joins slug and modifiers with "|", which has no
  // escape, so a modifier slug that itself contained "|" could collide with a
  // different line. menu-admin constrains real slugs to [a-z0-9-]+, so this
  // needs a hand-edited cookie to reach and only affects the sender's own
  // cart — a known, open, low-severity gap, not fixed here.
});
