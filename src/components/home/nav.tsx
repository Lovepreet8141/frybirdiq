"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { OrderStamp } from "./ctas";
import { Wordmark } from "./wordmark";

/**
 * Ported from frybird-web's src/components/site/nav.tsx. Homepage-only —
 * every other customer route (menu, cart, checkout, account, order
 * tracking) keeps its existing Header/Footer untouched, per the approved
 * scope. Exactly the four links the homepage nav is scoped to: Menu, Find
 * us, Franchise, Order now. Account and cart access remain reachable the
 * same way they already are everywhere else — from the real Header once a
 * visitor is inside /menu or beyond — this nav doesn't need to duplicate
 * that, it only needs to get someone there.
 */
const LINKS = [
  { href: "/menu", label: "Menu" },
  { href: "#find-us", label: "Find us" },
  { href: "#franchise", label: "Franchise" },
];

export function HomeNav() {
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setSolid(y > 24);
      // Slip away on a downward scroll past the first screen; come back on any upward scroll.
      if (y > last + 4 && y > window.innerHeight * 0.5) setHidden(true);
      else if (y < last - 4 || y < 80) setHidden(false);
      last = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fb-nav" data-hidden={hidden ? "true" : "false"} data-solid={solid ? "true" : "false"}>
      <Link aria-label="FRYBIRD home" className="fb-nav__brand" href="/">
        <Wordmark />
      </Link>
      <nav aria-label="Site">
        <ul className="fb-nav__links">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <OrderStamp />
    </header>
  );
}
