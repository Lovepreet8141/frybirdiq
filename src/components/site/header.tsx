import Link from "next/link";
import { ShoppingBag, User } from "lucide-react";
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
        <Link
          href="/"
          className="flex min-h-[44px] items-center font-heading text-xl font-bold tracking-tight"
          aria-label="FRYBIRD, home"
        >
          FRYB<span className="text-primary">I</span>RD
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
            className="ml-1 flex min-h-[44px] items-center gap-2 rounded-md bg-primary px-4 font-semibold text-primary-foreground transition-opacity duration-[var(--duration-micro)] hover:opacity-90"
          >
            <ShoppingBag className="size-4" aria-hidden="true" />
            <span className="tabular">{cart.itemCount}</span>
            <span className="sr-only">
              {cart.itemCount === 1 ? "item in your order" : "items in your order"}. View order.
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
