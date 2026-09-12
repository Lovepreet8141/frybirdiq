"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { type NavItem, type NavPermissions, buildNavGroups } from "./nav-items";

/**
 * The admin/operations nav, as a sidebar. Everything here is a LIVE
 * destination — a real, working page today. §6 of the request that prompted
 * this is explicit that a nav item opening a "coming soon" page is exactly
 * the fake placeholder functionality to avoid, so PLANNED groups (Inventory,
 * Staff, KDS, Settings) are documented in FRYBIRD-ADMIN-ARCHITECTURE.md and
 * simply don't appear here yet — they get added the pass their module
 * actually ships, not before.
 *
 * The group list itself comes from `buildNavGroups` (`nav-items.ts`), shared
 * with the command palette — this component only renders whatever groups
 * come back, so a future group needs no change here at all.
 *
 * POS (and, later, KDS) render this sidebar's own destination but never this
 * sidebar itself — see `app-chrome.tsx`. A touch/speed screen shouldn't
 * spend 16rem of width on navigation chrome.
 */
export function AppSidebar(permissions: NavPermissions) {
  const pathname = usePathname();
  const groups = buildNavGroups(permissions);

  const isActive = (item: NavItem) => {
    const on = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const excluded = item.exclude ? pathname === item.exclude || pathname.startsWith(`${item.exclude}/`) : false;
    return on && !excluded;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href={permissions.canSeeOrders ? "/app/orders" : "/app/deliveries"}
          className="flex min-h-[44px] items-center px-2 font-heading text-lg font-bold tracking-tight"
        >
          FRYBIRD <span className="text-primary">IQ</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
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
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
