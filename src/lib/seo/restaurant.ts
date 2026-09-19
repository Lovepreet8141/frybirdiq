/**
 * Local-business structured data.
 *
 * A restaurant that does not publish its address, hours and price range in a
 * form search engines read is invisible to "fried chicken near me", which is
 * how most of Ambala will look for it.
 *
 * Every field is a fact from the business. Nothing here is inferred, and the
 * two obvious temptations — an aggregate rating and a review count — are
 * deliberately absent. Marking up ratings that do not exist is both a lie and
 * a manual penalty.
 */

import { siteUrl } from "./site";

const SITE = siteUrl();

/** The default hours this shipped with, before Restaurant settings (roadmap 5.5) could change them. */
const DEFAULT_HOURS = { opens: "11:30", closes: "23:00" } as const;

/**
 * A 24-hour "HH:MM" as a person reads it — "11:30 AM", "11:00 PM". Used by
 * the homepage's "Kitchen hours" stat; `restaurantSchema` below prints the
 * same source value in the 24-hour form schema.org itself requires, so the
 * two never say something different from the same setting.
 */
export function formatHoursRange(opens: string, closes: string): string {
  const clock = (hhmm: string): string => {
    const [hoursPart, minutesPart] = hhmm.split(":");
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);
    const period = hours >= 12 ? "PM" : "AM";
    const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
    return `${twelveHour}:${String(minutes).padStart(2, "0")} ${period}`;
  };
  return `${clock(opens)} – ${clock(closes)}`;
}

export interface RestaurantPin {
  readonly lat: number;
  readonly lng: number;
}

/**
 * `pin` is the outlet's stored map pin (the same one delivery distance is
 * measured from and the directions link points at). Nothing here supplies a
 * coordinate of its own: with no pin stored, `geo` is omitted rather than
 * guessed. `telephone` likewise appears only when the outlet has one.
 */
export function restaurantSchema(
  hours: { readonly opens: string; readonly closes: string } = DEFAULT_HOURS,
  details: { readonly pin?: RestaurantPin | null; readonly telephone?: string | null } = {},
) {
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: "FRYBIRD",
    slogan: "Born crispy. Built bold.",
    url: SITE,
    servesCuisine: ["Fried chicken", "Fast food", "Burgers"],
    priceRange: "₹₹",
    currenciesAccepted: "INR",
    paymentAccepted: "Cash",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Sector 9",
      addressLocality: "Ambala City",
      addressRegion: "Haryana",
      postalCode: "134003",
      addressCountry: "IN",
    },
    ...(details.pin ? { geo: { "@type": "GeoCoordinates", latitude: details.pin.lat, longitude: details.pin.lng } } : {}),
    ...(details.telephone ? { telephone: details.telephone } : {}),
    image: `${SITE}/opengraph-image`,
    sameAs: ["https://www.instagram.com/frybirdindia/"],
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
        opens: hours.opens,
        closes: hours.closes,
      },
    ],
    hasMenu: `${SITE}/menu`,
    acceptsReservations: false,
    potentialAction: {
      "@type": "OrderAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE}/menu`,
        inLanguage: "en-IN",
        actionPlatform: [
          "http://schema.org/DesktopWebPlatform",
          "http://schema.org/MobileWebPlatform",
        ],
      },
      deliveryMethod: [
        "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet",
        "http://purl.org/goodrelations/v1#DeliveryModePickUp",
      ],
    },
  };
}
