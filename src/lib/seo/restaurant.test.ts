import { describe, expect, it } from "vitest";

import { formatHoursRange, restaurantSchema } from "./restaurant";

describe("restaurantSchema location", () => {
  const hours = { opens: "11:30", closes: "23:00" };

  it("reads the stored pin, never a coordinate of its own", () => {
    const schema = restaurantSchema(hours, { pin: { lat: 30.1234, lng: 76.5678 } }) as Record<string, unknown>;
    expect(schema.geo).toEqual({ "@type": "GeoCoordinates", latitude: 30.1234, longitude: 76.5678 });
  });

  it("omits geo when no pin is stored instead of guessing one", () => {
    expect((restaurantSchema(hours) as Record<string, unknown>).geo).toBeUndefined();
    expect((restaurantSchema(hours, { pin: null }) as Record<string, unknown>).geo).toBeUndefined();
  });

  it("carries a telephone only when the outlet has one", () => {
    expect((restaurantSchema(hours, { telephone: "98765 43210" }) as Record<string, unknown>).telephone).toBe("98765 43210");
    expect((restaurantSchema(hours, { telephone: null }) as Record<string, unknown>).telephone).toBeUndefined();
    expect((restaurantSchema(hours) as Record<string, unknown>).telephone).toBeUndefined();
  });
});

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

  it("defaults to the hours it shipped with, and reads a settings change when given one", () => {
    const spec = (schema.openingHoursSpecification as { opens: string; closes: string }[])[0]!;
    expect(spec).toMatchObject({ opens: "11:30", closes: "23:00" });

    const changed = restaurantSchema({ opens: "10:00", closes: "22:30" }) as Record<string, unknown>;
    const changedSpec = (changed.openingHoursSpecification as { opens: string; closes: string }[])[0]!;
    expect(changedSpec).toMatchObject({ opens: "10:00", closes: "22:30" });
  });
});

describe("formatHoursRange", () => {
  it("renders 24-hour times as a person reads them", () => {
    expect(formatHoursRange("11:30", "23:00")).toBe("11:30 AM – 11:00 PM");
    expect(formatHoursRange("09:00", "21:00")).toBe("9:00 AM – 9:00 PM");
  });

  it("handles midnight and noon", () => {
    expect(formatHoursRange("00:00", "12:00")).toBe("12:00 AM – 12:00 PM");
  });
});

describe("weekly days off in the structured data", () => {
  const days = (closedWeekdays?: readonly number[]) =>
    ((restaurantSchema({ opens: "11:30", closes: "23:00" }, { closedWeekdays }) as unknown as { openingHoursSpecification: { dayOfWeek: string[] }[] }).openingHoursSpecification[0]!.dayOfWeek);

  it("lists all seven days when nothing is closed", () => {
    expect(days()).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  });

  it("leaves Tuesday out when it is the day off, so a search engine never says 'open' on it", () => {
    expect(days([2])).toEqual(["Monday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(days([2])).not.toContain("Tuesday");
  });
});
