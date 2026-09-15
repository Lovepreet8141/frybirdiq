import Link from "next/link";
import { Bike, Clock, MapPin, Phone, ShoppingBag } from "lucide-react";

import { CinematicHero } from "@/components/site/cinematic-hero";
import { CombosStrip } from "@/components/site/combos-strip";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { LoyaltySection } from "@/components/loyalty/loyalty-section";
import { OrderNowBar } from "@/components/site/order-now-bar";
import { ProductCard } from "@/components/menu/product-card";
import { summarizeDeliveryBands, summarizeFreeDelivery } from "@/lib/delivery/summary";
import { getMenu } from "@/lib/repositories/menu";
import { getDeliverySettings } from "@/lib/repositories/delivery";
import { getOrg, getStoreContact } from "@/lib/repositories/org";
import { formatHoursRange, restaurantSchema } from "@/lib/seo/restaurant";

/**
 * Home. BUILD-PLAN.md §10.
 *
 * "The home page is a conversion surface, not a portfolio piece." One
 * confident hero, the picks, how to order, the two loyalty programs, why
 * the food is what it is, then where to find it. No menu browsing here —
 * that is what /menu is for.
 *
 * Redesigned toward the "stage/spotlight" cinematic identity commissioned
 * separately (frybird-web) — three real chapters of FRYBIRD's own footage,
 * a darker, more editorial rhythm, an oversized-glyph story beat — built
 * on exactly the same data this page already used. Every price and every
 * product is still read from the database; hardcoding them would give a
 * homepage that promises a number checkout doesn't charge.
 */

/** The four the menu leads with. A curatorial choice — §33: not called bestsellers. */
const PICKS = ["nashville-bomb", "chicken-wings", "paneer-champ", "frybird-loaded-fries"];

// Fixed facts about how the kitchen runs, not settings — "Kitchen hours"
// below is the one stat read from the organization, so changing opening
// hours in Restaurant settings changes what this shows.
const FIXED_HERO_STATS = [
  { label: "Ready in", value: "~15 minutes" },
  { label: "Heat levels", value: "Classic · Nashville" },
] as const;

export default async function HomePage() {
  const [menu, org, delivery, contact] = await Promise.all([
    getMenu("ONLINE"),
    getOrg(),
    getDeliverySettings(),
    getStoreContact(),
  ]);

  const products = menu.flatMap((category) => category.products);
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  const picks = PICKS.map((slug) => bySlug.get(slug)).filter((p): p is NonNullable<typeof p> => p !== undefined && p.availability.available);
  const combosCategory = menu.find((category) => category.slug === "combos");

  const opens = org?.openingTime ?? "11:30";
  const closes = org?.closingTime ?? "23:00";
  const heroStats = [{ label: "Kitchen hours", value: formatHoursRange(opens, closes) }, ...FIXED_HERO_STATS];

  const bandLines = delivery?.enabled ? summarizeDeliveryBands(delivery.rates) : [];
  const freeLine = delivery?.enabled ? summarizeFreeDelivery(delivery.rates) : null;
  const deliveryDetail = freeLine ?? bandLines[0] ?? "Priced by distance at checkout";

  const address = contact ? [contact.addressLine1, contact.addressLine2, contact.city, contact.state].filter(Boolean).join(", ") : "Sector 9, Ambala City, Haryana";

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(restaurantSchema({ opens, closes })) }}
      />

      <CinematicHero heroStats={heroStats} />

      {/* ───────────── ticker ───────────── */}
      <div
        aria-hidden="true"
        className="hero-ticker border-b border-[var(--cream-hi)]/10 bg-[var(--ink)] py-3 font-heading text-sm font-extrabold tracking-[0.16em] text-[var(--cream-hi)]"
      >
        <span>
          <span>
            NASHVILLE HOT <i className="mx-4 not-italic text-primary">✦</i> SMASHED DAILY{" "}
            <i className="mx-4 not-italic text-primary">✦</i> FRIED TO ORDER{" "}
            <i className="mx-4 not-italic text-primary">✦</i> 12-HOUR BRINE{" "}
            <i className="mx-4 not-italic text-primary">✦</i> LOADED FRIES{" "}
            <i className="mx-4 not-italic text-primary">✦</i> BORN CRISPY BUILT BOLD{" "}
            <i className="mx-4 not-italic text-primary">✦</i>{" "}
          </span>
          <span>
            NASHVILLE HOT <i className="mx-4 not-italic text-primary">✦</i> SMASHED DAILY{" "}
            <i className="mx-4 not-italic text-primary">✦</i> FRIED TO ORDER{" "}
            <i className="mx-4 not-italic text-primary">✦</i> 12-HOUR BRINE{" "}
            <i className="mx-4 not-italic text-primary">✦</i> LOADED FRIES{" "}
            <i className="mx-4 not-italic text-primary">✦</i> BORN CRISPY BUILT BOLD{" "}
            <i className="mx-4 not-italic text-primary">✦</i>{" "}
          </span>
        </span>
      </div>

      {/* ───────────── the heavy hitters ───────────── */}
      <section id="menu" aria-labelledby="picks-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-16 sm:py-20">
          <Reveal>
            <h2
              id="picks-heading"
              className="text-center font-heading text-[clamp(2rem,6vw,3.4rem)] font-black italic leading-none tracking-[-0.03em] text-primary [font-stretch:75%]"
            >
              The heavy hitters
            </h2>
          </Reveal>
          <Reveal delay={0.06}>
            <p className="mt-2 text-center text-muted-foreground">What Ambala keeps coming back for.</p>
          </Reveal>

          {picks.length > 0 && (
            <Stagger className="mt-10 grid gap-5 [perspective:1000px] sm:grid-cols-2 lg:grid-cols-4">
              {picks.map((product, index) => (
                <StaggerItem key={product.slug} className="flex">
                  <ProductCard product={product} priority={index < 4} />
                </StaggerItem>
              ))}
            </Stagger>
          )}

          <Reveal delay={0.12}>
            <div className="mt-10 text-center">
              <Link
                href="/menu"
                className="inline-flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] px-7 font-heading text-sm font-extrabold shadow-[4px_4px_0_var(--red)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[6px_7px_0_var(--red)]"
              >
                See the full menu
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <CombosStrip category={combosCategory} />

      {/* ───────────── how to get it ───────────── */}
      <section aria-labelledby="how-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-14 sm:py-16">
          <Reveal>
            <h2 id="how-heading" className="font-heading text-2xl font-extrabold">How to get it</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick whatever&rsquo;s fastest from where you are.</p>
          </Reveal>

          {/*
            Two routes, not three. FRYBIRD sells direct — no aggregator, no
            commission — so a Zomato-style row has no place on the page.
          */}
          <Stagger className="mt-6 flex flex-col gap-3">
            {[
              {
                href: "/menu?fulfilment=takeaway",
                icon: ShoppingBag,
                title: "Pick up from Sector 9",
                detail: "No delivery fee · ready in about 15 minutes",
              },
              {
                href: "/menu?fulfilment=delivery",
                icon: Bike,
                title: "Delivery across Ambala City",
                detail: deliveryDetail,
              },
            ].map((option) => (
              <StaggerItem key={option.href}>
                <Link
                  href={option.href}
                  className="flex min-h-[76px] cursor-pointer items-center gap-4 rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-4 shadow-[5px_5px_0_var(--red)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-[3px] hover:shadow-[8px_9px_0_var(--red)]"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <option.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col">
                    <span className="font-semibold">{option.title}</span>
                    <span className="mt-0.5 text-sm text-muted-foreground">{option.detail}</span>
                  </span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ───────────── loyalty ───────────── */}
      <LoyaltySection />

      {/* ───────────── story: the oversized-glyph beat ─────────────
          "The fryer is the stage" — the same three facts this page has
          always told (brine time, fry time, heat levels), read once as an
          editorial metrics strip instead of three icon cards. The golden
          "I" is the wordmark's own accent letter (design-system/MASTER.md
          §2: "the dot on the I"), oversized as the section's one structural
          glyph rather than decoration bolted on. */}
      <section aria-labelledby="story-heading" className="relative overflow-hidden border-b border-[var(--cream-hi)]/10 bg-[var(--red-deep)] text-[var(--cream-hi)]">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-[2%] font-heading text-[52vw] leading-none font-black text-primary/15 italic select-none sm:right-[6%] sm:text-[34vw] [font-stretch:75%]"
        >
          I
        </span>

        <div className="relative mx-auto w-full max-w-6xl px-[var(--gutter)] py-16 sm:py-24">
          <Reveal>
            <h2 id="story-heading" className="max-w-lg font-heading text-[clamp(1.9rem,5vw,3rem)] font-black italic leading-[1.02] tracking-tight [font-stretch:75%]">
              Everything starts in the fryer.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--cream-2)]/90">
              No heat lamps, no holding trays, nothing fried before your order exists. That&rsquo;s the wait, and it isn&rsquo;t negotiable.
            </p>
          </Reveal>

          <Stagger className="mt-12 grid grid-cols-1 gap-8 border-t border-[var(--cream-hi)]/15 pt-10 sm:grid-cols-3">
            {[
              { value: "12 hrs", label: "Buttermilk brine, every batch" },
              { value: "15 min", label: "Fryer to your hands" },
              { value: "2", label: "Heat levels — Classic, Nashville" },
            ].map((stat) => (
              <StaggerItem key={stat.label}>
                <p className="tabular font-heading text-5xl font-black text-primary sm:text-6xl [font-stretch:75%]">{stat.value}</p>
                <p className="mt-2 text-sm text-[var(--cream-2)]/85">{stat.label}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ───────────── find us ───────────── */}
      <section id="visit" aria-labelledby="find-heading">
        <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-14 pb-[104px] sm:py-16 lg:pb-16">
          <Reveal>
            <h2 id="find-heading" className="font-heading text-2xl font-extrabold">Find us</h2>
          </Reveal>

          <ul className="mt-6 flex flex-col gap-4 text-sm">
            <li className="flex gap-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                {address}
                <span className="block text-muted-foreground">Fried to order — give us about fifteen minutes.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                {formatHoursRange(opens, closes)}
                <span className="block text-muted-foreground">Every day</span>
              </span>
            </li>
            <li className="flex gap-3">
              <Phone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              {contact?.phone ? (
                <a href={`tel:${contact.phone}`} className="tabular font-semibold hover:underline">
                  {contact.phone}
                </a>
              ) : (
                <span className="text-muted-foreground">
                  Phone number not published yet — order through the site and we&rsquo;ll call you if we need to.
                </span>
              )}
            </li>
            {bandLines.length > 0 && (
              <li className="flex gap-3">
                <Bike className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex flex-col text-muted-foreground">
                  {freeLine && <span className="font-semibold text-foreground">{freeLine}</span>}
                  {bandLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </span>
              </li>
            )}
          </ul>

          <a
            href="https://maps.google.com/?q=Sector+9+Ambala+City+Haryana"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-[44px] items-center rounded-lg border border-border-strong px-5 font-semibold transition-colors hover:bg-secondary"
          >
            Open in Google Maps
          </a>
        </div>
      </section>

      {/* Homepage only — the header's cart button covers every other page,
          and a bar pinned to every screen stopped meaning "start an order"
          and started meaning wallpaper. */}
      <OrderNowBar />
    </>
  );
}
