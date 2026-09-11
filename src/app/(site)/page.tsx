import Link from "next/link";
import { Bike, Clock, Flame, MapPin, Phone, ShoppingBag, Timer } from "lucide-react";

import { PremiumHero } from "@/components/hero/premium-hero";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { LoyaltySection } from "@/components/loyalty/loyalty-section";
import { OrderNowBar } from "@/components/site/order-now-bar";
import { ProductCard } from "@/components/menu/product-card";
import { getAllProducts } from "@/lib/repositories/menu";
import { restaurantSchema } from "@/lib/seo/restaurant";

/**
 * Home. BUILD-PLAN.md §10.
 *
 * "The home page is a conversion surface, not a portfolio piece." One
 * confident hero, the picks, how to order, the two loyalty programs, why
 * the food is what it is, then where to find it. No menu browsing here —
 * that is what /menu is for; a preview of it on the homepage duplicated the
 * same six categories a tap away and gave the page nowhere to breathe.
 *
 * Every price and every product on this page is read from the database. The
 * design comp carries its own numbers; hardcoding them would give a homepage
 * that promises ₹139 while the checkout charges something else, and the drift
 * would be invisible until a customer complained.
 */

/** The four the menu leads with. A curatorial choice — §33: not called bestsellers. */
const PICKS = ["nashville-bomb", "chicken-wings", "paneer-champ", "frybird-loaded-fries"];

const HERO_STATS = [
  { label: "Kitchen hours", value: "11:30 AM – 11 PM" },
  { label: "Ready in", value: "~15 minutes" },
  { label: "Heat levels", value: "Classic · Nashville" },
] as const;

export default async function HomePage() {
  const products = await getAllProducts();
  const bySlug = new Map(products.map((product) => [product.slug, product]));

  const picks = PICKS.map((slug) => bySlug.get(slug)).filter((p) => p !== undefined);
  const hero = bySlug.get("og-smash") ?? bySlug.get("nashville-bomb");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(restaurantSchema()) }}
      />

      <PremiumHero productImage={hero?.image ?? null} stats={HERO_STATS} />

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
      <section id="picks" aria-labelledby="picks-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-16 sm:py-20">
          <Reveal>
            <h2
              id="picks-heading"
              className="text-center font-heading text-[clamp(2rem,6vw,3.4rem)] font-black italic leading-none tracking-[-0.03em] text-primary"
            >
              The heavy hitters
            </h2>
          </Reveal>
          <Reveal delay={0.06}>
            <p className="mt-2 text-center text-muted-foreground">What Ambala keeps coming back for.</p>
          </Reveal>

          {/* The row carries the perspective; the card's hover tilt is
              meaningless without one on its parent. */}
          <Stagger className="mt-10 grid gap-5 [perspective:1000px] sm:grid-cols-2 lg:grid-cols-4">
            {picks.map((product, index) => (
              <StaggerItem key={product.slug} className="flex">
                <ProductCard product={product} priority={index < 4} />
              </StaggerItem>
            ))}
          </Stagger>

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

      {/* ───────────── how to get it ───────────── */}
      <section aria-labelledby="how-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-14 sm:py-16">
          <Reveal>
            <h2 id="how-heading" className="font-heading text-2xl font-extrabold">How to get it</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick whatever&rsquo;s fastest from where you are.</p>
          </Reveal>

          {/*
            Two routes, not three. The design comp has a Zomato row; FRYBIRD
            sells direct, so a link handing the order to an aggregator — and
            its commission — has no place on the page.
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
                detail: "Free within 3 km · ₹30 to 5 km · ₹10/km beyond",
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

      {/* ───────────── why frybird ───────────── */}
      <section id="why" aria-labelledby="why-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-14 sm:py-16">
          <Reveal>
            <h2 id="why-heading" className="font-heading text-2xl font-extrabold">Why FRYBIRD</h2>
          </Reveal>

          <Stagger className="mt-6 grid gap-5 sm:grid-cols-3">
            {[
              {
                icon: Flame,
                title: "Fried when you order, not before",
                body: "No heat lamps, no holding trays. Every piece hits the fryer after your order comes in — that's the wait, and it's not negotiable.",
              },
              {
                icon: Clock,
                title: "Brined twelve hours, not twenty minutes",
                body: "Buttermilk brine, overnight, every batch. The difference between chicken seasoned through and chicken that just tastes salty outside.",
              },
              {
                icon: Timer,
                title: "Heat that builds, not just burns",
                body: "Cayenne oil brushed on hot, layered rather than dumped. First bite is flavour. Third bite is when you reach for the drink.",
              },
            ].map((card) => (
              <StaggerItem
                key={card.title}
                className="rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-5 shadow-[6px_6px_0_var(--red)]"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <card.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-3 font-bold">{card.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
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
                Sector 9, Ambala City, Haryana 134003
                <span className="block text-muted-foreground">Fried to order — give us about fifteen minutes.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                11:30 AM – 11:00 PM
                <span className="block text-muted-foreground">Every day</span>
              </span>
            </li>
            <li className="flex gap-3">
              <Phone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-muted-foreground">
                Phone number not published yet — order through the site and we&rsquo;ll call you if we need to.
              </span>
            </li>
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
