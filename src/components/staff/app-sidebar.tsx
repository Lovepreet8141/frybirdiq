"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, LayoutGrid, LayoutList, Image as ImageIcon, Layers3, Package, ShoppingBag, Truck, UtensilsCrossed } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  /** A path prefix this item should NOT match even though it starts with `href` — mirrors AppNavLink's `exclude`. */
  readonly exclude?: string;
}

/**
 * The admin/operations nav, as a sidebar. Everything here is a LIVE
 * destination — a real, working page today. §6 of the request that prompted
 * this is explicit that a nav item opening a "coming soon" page is exactly
 * the fake placeholder functionality to avoid, so PLANNED groups (Inventory,
 * Staff, full Customers, KDS, Settings) are documented in
 * FRYBIRD-ADMIN-ARCHITECTURE.md and simply don't appear here yet — they get
 * added the pass their module actually ships, not before.
 *
 * POS (and, later, KDS) render this sidebar's own destination but never this
 * sidebar itself — see `app-chrome.tsx`. A touch/speed screen shouldn't
 * spend 16rem of width on navigation chrome.
 */
export function AppSidebar({
  canSeeOrders,
  canSeePos,
  canSeeDeliveries,
  canSeeMenu,
  canSeeAnalytics,
}: {
  canSeeOrders: boolean;
  canSeePos: boolean;
  canSeeDeliveries: boolean;
  canSeeMenu: boolean;
  canSeeAnalytics: boolean;
}) {
  const pathname = usePathname();

  const operations: NavItem[] = [
    ...(canSeeAnalytics ? [{ href: "/app/iq", label: "Overview", icon: LayoutGrid, exclude: "/app/iq/menu" }] : []),
    ...(canSeeOrders ? [{ href: "/app/orders", label: "Orders", icon: ClipboardList }] : []),
    ...(canSeePos ? [{ href: "/app/pos", label: "POS", icon: ShoppingBag }] : []),
    ...(canSeeDeliveries ? [{ href: "/app/deliveries", label: "Deliveries", icon: Truck }] : []),
  ];

  const menu: NavItem[] = canSeeMenu
    ? [
        { href: "/app/iq/menu", label: "Menu overview", icon: UtensilsCrossed },
        { href: "/app/iq/menu/products", label: "Products", icon: Package },
        { href: "/app/iq/menu/modifiers", label: "Modifiers", icon: Layers3 },
        { href: "/app/iq/menu/combos", label: "Combos", icon: LayoutList },
        { href: "/app/iq/menu/media", label: "Media", icon: ImageIcon },
        { href: "/app/iq/menu/review", label: "Review queue", icon: ClipboardList },
      ]
    : [];

  const isActive = (item: NavItem) => {
    const on = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const excluded = item.exclude ? pathname === item.exclude || pathname.startsWith(`${item.exclude}/`) : false;
    return on && !excluded;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href={canSeeOrders ? "/app/orders" : "/app/deliveries"}
          className="flex min-h-[44px] items-center px-2 font-heading text-lg font-bold tracking-tight"
        >
          FRYBIRD <span className="text-primary">IQ</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {operations.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Operations</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {operations.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(item)}
                      tooltip={item.label}
                      render={
                        <Link href={item.href} aria-current={isActive(item) ? "page" : undefined}>
                          <item.icon className="size-4" aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {menu.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Menu</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {menu.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(item)}
                      tooltip={item.label}
                      render={
                        <Link href={item.href} aria-current={isActive(item) ? "page" : undefined}>
                          <item.icon className="size-4" aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
