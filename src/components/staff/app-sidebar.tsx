"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { type NavItem, type NavPermissions, buildNavGroups } from "./nav-items";

/**
 * The staff nav, in the purchased kit's sidebar shape
 * (`shadcn-ui-kit-dashboard/components/layout/sidebar`): inset variant, icon
 * collapse, a brand block as the first menu button, groups inside a scroll
 * area. What's in it is still ours — `buildNavGroups` (shared with the
 * command palette, so the two can never disagree), one lucide icon per
 * item, and only LIVE destinations. Every colour and font comes from the
 * `[data-surface="iq"]` tokens; nothing here is a kit colour.
 *
 * POS and KDS render this sidebar's destinations but never this sidebar —
 * see `app-chrome.tsx`. A touch/speed screen shouldn't spend 16rem of width
 * on navigation chrome.
 */
export function AppSidebar(permissions: NavPermissions) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const groups = buildNavGroups(permissions);

  // On a phone the sidebar is a sheet; navigating should close it, the way
  // the kit's does, or the new page sits behind the menu you just used.
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathname is the trigger; the other two are stable
  }, [pathname]);

  const isActive = (item: NavItem) => {
    const on = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const excluded = (item.exclude ?? []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    return on && !excluded;
  };

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-10 hover:text-foreground group-data-[collapsible=icon]:px-0!">
              <Link href={permissions.canSeeOrders ? "/app/orders" : "/app/deliveries"} aria-label="FRYBIRD IQ home">
                <span
                  aria-hidden="true"
                  className="me-1 grid size-8 shrink-0 place-items-center rounded-[5px] bg-primary font-heading text-base font-bold text-primary-foreground"
                >
                  F
                </span>
                <span className="font-heading text-base font-bold tracking-tight text-foreground">
                  FRYBIRD <span className="text-primary">IQ</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <ScrollArea className="h-full">
          {groups.map((group) => (
            <SidebarGroup key={group.id}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent className="flex flex-col gap-2">
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton isActive={isActive(item)} tooltip={item.label} asChild>
                        <Link href={item.href} aria-current={isActive(item) ? "page" : undefined}>
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </ScrollArea>
      </SidebarContent>
    </Sidebar>
  );
}
