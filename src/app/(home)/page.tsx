import type { Metadata } from "next";

import { HomeNav } from "@/components/home/nav";
import { Hero } from "@/components/home/hero";
import { Marquee } from "@/components/home/marquee";
import { Bestsellers, type HomeBestseller } from "@/components/home/bestsellers";
import { Range } from "@/components/home/range";
import { Story } from "@/components/home/story";
import { Location } from "@/components/home/location";
import { FranchiseForm } from "@/components/home/franchise-form";
import { HomeFooter } from "@/components/home/footer";
import { HomeOrderBar } from "@/components/home/order-bar";
import { ShopClosedNotice } from "@/components/site/shop-closed-notice";
import { shopPhone } from "@/lib/contact/phone";
import { shopHoursState } from "@/lib/cart/shop-hours";
import { HomeMotion } from "@/components/home/motion";
import { getAllProductsCached } from "@/lib/repositories/menu-cache";
import { toLatLng } from "@/lib/delivery";
import { getDeliverySettings } from "@/lib/repositories/delivery";
import { getOrg, getStoreContact } from "@/lib/repositories/org";
import { getCustomer } from "@/lib/customer";
import { formatHoursRange, restaurantSchema } from "@/lib/seo/restaurant";
import { summarizeDeliveryBands, summarizeFreeDelivery } from "@/lib/delivery/summary";

export const metadata: Metadata = {
  // Absolute: the layout template would append "· FRYBIRD" to a title that already opens with it.
  title: { absolute: "FRYBIRD, Ambala City. Born crispy. Built bold." },
  alternates: { canonical: "/" },
  description:
    "Hand-breaded fried chicken in Sector 9, Ambala City. Burgers, wraps, wings, loaded fries and party boxes, fried after you order. Pick-up or delivery.",
};
export const dynamic = "force-dynamic";

/** Which six product slugs the front page features, and their commissioned clips — an editorial choice, same as this app's other curated picks (§33: not called "bestsellers" by an invented metric). FRYBIRD IQ has no "featured" flag to be authoritative over; the *content* behind each slot (name, price, description, whether it shows at all) is authoritative. */
const BESTSELLER_SLUGS = [
  { slug: "frybird-loaded-fries", tag: "Most ordered", video: "/home/video/frybird-loaded-fries.mp4", poster: "/home/video/frybird-loaded-fries.jpg" },
  { slug: "thunder-burger", tag: "Triple garlic", video: "/home/video/thunder-burger.mp4", poster: "/home/video/thunder-burger.jpg" },
  { slug: "nashville-bomb", tag: "Hottest", video: "/home/video/nashville-bomb.mp4", poster: "/home/video/nashville-bomb.jpg" },
  { slug: "chicken-tenders", tag: "Dip it", video: "/home/video/tenders.mp4", poster: "/home/video/tenders.jpg" },
  { slug: "popcorn-chicken", tag: "Share box", video: "/home/video/popcorn.mp4", poster: "/home/video/popcorn.jpg" },
] as const;

const CITY = "Ambala City";
const ADDRESS_ONE_LINE = "Shop 31-B, Shopping Complex, Sector 9, Ambala City, Haryana 134003";
const MAPS_PLACE_URL = "https://maps.google.com/?cid=16250293097084103835";
/** Used only while the outlet has no stored pin; with one, directions and the structured data both read it. */
const FALLBACK_MAPS_DIRECTIONS_URL = "https://www.google.com/maps/dir/?api=1&destination=30.3618007%2C76.7808927";

function directionsUrl(pin: { lat: number; lng: number } | null): string {
  return pin ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${pin.lat},${pin.lng}`)}` : FALLBACK_MAPS_DIRECTIONS_URL;
}

export default async function HomePage() {
  const [org, contact, delivery, products, customer] = await Promise.all([
    getOrg(),
    getStoreContact(),
    getDeliverySettings(),
    getAllProductsCached("ONLINE"),
    getCustomer(),
  ]);
  // Only whether someone is signed in crosses into the client nav — never the
  // customer record itself.
  const signedIn = customer !== null;

  const opens = org?.openingTime ?? "11:30";
  const closes = org?.closingTime ?? "23:00";
  const hoursValue = formatHoursRange(opens, closes);

  const byslug = new Map(products.map((p) => [p.slug, p] as const));
  const bestsellers: HomeBestseller[] = BESTSELLER_SLUGS.map((entry): HomeBestseller | null => {
    const product = byslug.get(entry.slug);
    if (!product || !product.availability.available) return null;
    return {
      slug: product.slug,
      name: product.name,
      tag: entry.tag,
      note: product.description ?? "",
      price: Number(product.price) / 100,
      video: entry.video,
      poster: entry.poster,
    };
  }).filter((item): item is HomeBestseller => item !== null);

  const addressLines = contact
    ? [contact.addressLine1, contact.addressLine2, [contact.city, contact.state].filter(Boolean).join(", "), "Haryana 134003"].filter(
        (line): line is string => Boolean(line),
      )
    : ["Shop 31-B, Shopping Complex", "Sector 9, Ambala City", "Haryana 134003"];

  const bandLines = delivery?.enabled ? summarizeDeliveryBands(delivery.rates) : [];
  const freeLine = delivery?.enabled ? summarizeFreeDelivery(delivery.rates) : null;
  const deliveryText = freeLine ?? bandLines[0] ?? "Delivery priced by distance at checkout.";
  const maxDeliveryKm = delivery?.enabled && delivery.rates.bands.length > 0 ? delivery.rates.bands[delivery.rates.bands.length - 1]!.upToMetres / 1000 : null;
  const deliveryChip = maxDeliveryKm ? `${Number.isInteger(maxDeliveryKm) ? maxDeliveryKm : maxDeliveryKm.toFixed(1)} km delivery` : "Pick-up or delivery";

  // One stored pin for the map link and the structured data, so they cannot disagree.
  const pin = delivery?.shop ? toLatLng(delivery.shop) : null;
  const phone = shopPhone(contact?.phone);
  const phoneDisplay = phone?.display ?? null;
  const phoneHref = phone?.href ?? null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(restaurantSchema({ opens, closes }, { pin, telephone: phone?.display ?? null })) }}
      />
      <div className="fb">
        <HomeNav signedIn={signedIn} />
        <main>
          {org && !shopHoursState(new Date(), opens, closes).open && (
            <div style={{ background: "var(--fb-ink-deep)", padding: "calc(var(--nav-h) + 0.75rem) var(--fb-gutter) 0.75rem" }}>
              <ShopClosedNotice
                openingTime={opens}
                closingTime={closes}
                className="border-[var(--fb-on-ink-30)] bg-transparent text-[var(--fb-on-ink)]"
              />
            </div>
          )}
          <Hero
            city={CITY}
            stats={[
              { label: "Kitchen hours", value: hoursValue },
              { label: "Ready in", value: "About 15 minutes" },
              { label: "Heat levels", value: "Classic, Grazy Bird, Nashville" },
            ]}
          />
          <Marquee />
          <Bestsellers items={bestsellers} />
          <Range />
          <Story />
          <Location
            addressLines={addressLines}
            addressOneLine={contact ? addressLines.join(", ") : ADDRESS_ONE_LINE}
            deliveryChip={deliveryChip}
            deliveryText={deliveryText}
            hoursLabel="Open daily"
            hoursValue={hoursValue}
            mapsDirectionsUrl={directionsUrl(pin)}
            mapsPlaceUrl={MAPS_PLACE_URL}
            phoneDisplay={phoneDisplay}
            phoneHref={phoneHref}
            prepTime="Fried to order — about fifteen minutes"
          />
          <FranchiseForm />
        </main>
        <HomeFooter addressLines={addressLines} city={CITY} hoursLabel="Open daily" hoursValue={hoursValue} />
        <HomeOrderBar />
        <HomeMotion />
      </div>
    </>
  );
}
