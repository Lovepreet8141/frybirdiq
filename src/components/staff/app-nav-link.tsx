"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A top-level staff-area nav link that highlights itself on its own section.
 *
 * `AppLayout` (the Server Component that renders the nav) does not know the
 * current path — Next's App Router gives that to a Client Component via
 * `usePathname`, not to the layout wrapping it — so the active-state check
 * lives here, in the one place that needs it, rather than turning the whole
 * staff shell into a client component just to read the URL.
 *
 * `exclude` lets "IQ" (`/app/iq`) not light up while `/app/iq/menu` is open,
 * since Menu is a sibling item under the same path prefix, not a page IQ's
 * own link should claim.
 */
export function AppNavLink({
  href,
  exclude,
  children,
}: {
  href: string;
  /** A path prefix this link should NOT match, even though it starts with `href`. */
  exclude?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (pathname === href || pathname.startsWith(`${href}/`)) && !(exclude && (pathname === exclude || pathname.startsWith(`${exclude}/`)));

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={
        isActive
          ? "flex min-h-[44px] items-center rounded-md bg-secondary px-3 text-sm font-semibold text-secondary-foreground transition-colors"
          : "flex min-h-[44px] items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}
