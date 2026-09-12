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
  { prefix: "/app/iq/products", label: "Products" },
  { prefix: "/app/iq/pnl", label: "Profit and loss" },
  { prefix: "/app/iq/expenses", label: "Expenses" },
  { prefix: "/app/iq/rewards", label: "Rewards" },
  { prefix: "/app/iq", label: "Overview" },
  { prefix: "/app/admin/restaurant", label: "Restaurant" },
  { prefix: "/app/admin/audit", label: "Audit log" },
  { prefix: "/app/inventory/suppliers", label: "Suppliers" },
  { prefix: "/app/inventory", label: "Ingredients" },
  { prefix: "/app/customers/promotions", label: "Promotions" },
  { prefix: "/app/customers", label: "Customers" },
  { prefix: "/app/staff", label: "Staff" },
  { prefix: "/app/finance", label: "Payments" },
  { prefix: "/app/kds", label: "Kitchen" },
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
      <BreadcrumbList className="flex-nowrap">
        {/* On a phone the header is 56px and the sidebar already carries the
            brand; the root crumb would only wrap. The section alone is enough. */}
        <BreadcrumbItem className={section ? "hidden sm:inline-flex" : undefined}>
          {section ? (
            <BreadcrumbLink asChild><Link href="/app/iq">FRYBIRD IQ</Link></BreadcrumbLink>
          ) : (
            <BreadcrumbPage>FRYBIRD IQ</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {section && (
          <>
            <BreadcrumbSeparator className="hidden sm:block" />
            <BreadcrumbItem className="whitespace-nowrap">
              <BreadcrumbPage>{section}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
