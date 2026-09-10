import { describe, expect, it } from "vitest";

import { restaurantSchema } from "./restaurant";

describe("restaurantSchema", () => {
  const schema = restaurantSchema() as Record<string, unknown>;

  it("declares itself as a Restaurant with the address search needs", () => {
    expect(schema["@type"]).toBe("Restaurant");
    expect(schema.address).toMatchObject({
      addressLocality: "Ambala City",
      addressRegion: "Haryana",
      addressCountry: "IN",
    });
  });

  it("claims no rating", () => {
    // Marking up an aggregateRating with no reviews behind it is a lie to the
    // search engine and a manual penalty when it is noticed.
    expect(schema.aggregateRating).toBeUndefined();
    expect(schema.review).toBeUndefined();
  });

  it("says cash only, because that is what the app takes today", () => {
    expect(schema.paymentAccepted).toBe("Cash");
  });

  it("points ordering at the site's own menu, not an aggregator", () => {
    const action = schema.potentialAction as { target: { urlTemplate: string } };
    expect(action.target.urlTemplate).toMatch(/\/menu$/);
    expect(JSON.stringify(schema)).not.toMatch(/swiggy|zomato/i);
  });

  it("serialises to valid JSON with no undefined holes", () => {
    const json = JSON.stringify(schema);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toContain("undefined");
  });
});
