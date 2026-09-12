"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

/**
 * Where you are, at a glance — the persistent top-bar trail every dashboard
 * needs once there's more than a couple of destinations. A static map, not a
 * pathname-parsing algorithm: FRYBIRD's URL structure (`/app/iq/menu/products`
 * is "Menu", not "Iq / Menu / Products") doesn't match its folder depth, and
 * guessing that generically would be wrong more often than a short explicit
 * list is expensive to maintain.
 *
 * Ordered longest-prefix-first so `/app/iq/menu` matches before the bare
 * `/app/iq` overview entry does.
 */
const SECTIONS: readonly { readonly prefix: string; readonly label: string }[] = [
  { prefix: "/app/iq/menu", label: "Menu" },
  { prefix: "/app/iq/live", label: "Live operations" },
  { prefix: "/app/iq/activity", label: "Activity" },
  { prefix: "/app/iq/channels", label: "Channels" },
  { prefix: "/app/iq/pnl", label: "Profit and loss" },
  { prefix: "/app/iq/expenses", label: "Expenses" },
  { prefix: "/app/iq/rewards", label: "Rewards" },
  { prefix: "/app/iq", label: "Overview" },
  { prefix: "/app/orders", label: "Orders" },
  { prefix: "/app/pos", label: "POS" },
  { prefix: "/app/deliveries", label: "Deliveries" },
];

function sectionFor(pathname: string): string | null {
  const match = SECTIONS.find((section) => pathname === section.prefix || pathname.startsWith(`${section.prefix}/`));
  return match?.label ?? null;
}

export function SectionBreadcrumb() {
  const pathname = usePathname();
  const section = sectionFor(pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {section ? (
            <BreadcrumbLink render={<Link href="/app/iq" />}>FRYBIRD IQ</BreadcrumbLink>
          ) : (
            <BreadcrumbPage>FRYBIRD IQ</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {section && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{section}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
