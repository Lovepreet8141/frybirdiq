import Image from "next/image";
import Link from "next/link";
import { ShoppingBag, User } from "lucide-react";
import { CartBadge } from "@/components/site/cart-badge";
import { getPricedCart } from "@/lib/cart";
import { getCustomer } from "@/lib/customer";

const LINKS = [{ href: "/menu", label: "Menu" }];

/**
 * Site header.
 *
 * A Server Component, so the cart count is the server's own count rather than
 * something the browser told us. It is read on every navigation; there is no
 * client-side cart state to fall out of step.
 */
export async function Header() {
  const [cart, customer] = await Promise.all([getPricedCart(), getCustomer()]);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-[68px] w-full max-w-6xl items-center justify-between gap-4 px-[var(--gutter)]">
        <Link href="/" className="flex min-h-[44px] items-center" aria-label="FRYBIRD, home">
          {/*
            The wordmark is cream and amber on a transparent ground, drawn to
            sit on the charred background. Width is set and height derived from
            the 4.5:1 artwork, so nothing shifts as it loads.
          */}
          <Image
            src="/frybird-wordmark-ink.svg"
            alt="FRYBIRD"
            width={132}
            height={30}
            priority
            className="h-[26px] w-auto sm:h-[30px]"
          />
        </Link>

        <nav className="flex items-center gap-1" aria-label="Main">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors duration-[var(--duration-standard)] hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}

          <Link
            href={customer ? "/account" : "/account/sign-in"}
            className="flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors duration-[var(--duration-standard)] hover:text-foreground"
          >
            <User className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{customer ? (customer.name ?? "Account") : "Sign in"}</span>
            <span className="sr-only sm:hidden">{customer ? "Your account" : "Sign in"}</span>
          </Link>

          <Link
            href="/cart"
            className="ml-1 flex min-h-[44px] cursor-pointer items-center gap-2 overflow-hidden rounded-xl border-[2.5px] border-[var(--ink)] bg-primary px-4 font-heading font-extrabold text-primary-foreground shadow-[3px_3px_0_var(--ink)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[5px_6px_0_var(--ink)]"
          >
            <ShoppingBag className="size-4" aria-hidden="true" />
            <CartBadge count={cart.itemCount} />
            <span className="sr-only">
              {cart.itemCount === 1 ? "item in your order" : "items in your order"}. View order.
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
