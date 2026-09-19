import { describe, expect, it } from "vitest";
import { itemShareImage } from "./item-share";

describe("itemShareImage", () => {
  it("uses the item's own photo, made absolute", () => {
    expect(itemShareImage({ url: "/products/burger.webp", alt: "A burger" }, "Burger")).toEqual({ url: "https://frybirdiq.tech/products/burger.webp", alt: "A burger" });
  });

  it("leaves an already-absolute photo URL alone", () => {
    expect(itemShareImage({ url: "https://x.supabase.co/a.webp", alt: "a" }, "X").url).toBe("https://x.supabase.co/a.webp");
  });

  it("falls back to the site share image when the item has no photo", () => {
    for (const none of [null, undefined]) {
      const image = itemShareImage(none, "Nashville Smash");
      expect(image.url).toBe("https://frybirdiq.tech/opengraph-image");
      expect(image.alt).toContain("Nashville Smash");
    }
  });
});
