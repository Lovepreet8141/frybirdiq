"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Role } from "@/domain/permissions";
import { cn } from "@/lib/utils";
import { type NavItem, type NavPermissions, buildNavGroups } from "./nav-items";

export interface SidebarStore {
  readonly name: string;
  readonly line: string;
}

export interface SidebarStaff {
  readonly displayName: string | null;
  readonly roles: readonly Role[];
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

/**
 * The staff nav, in the FRYBIRD IQ shell: the mark and wordmark, the store
 * block, grouped destinations with an 11px group label, and a cream active
 * row with a brand-red bar that slides between items (brand red as
 * identity, never as signal). The footer is who is signed in.
 *
 * What is in it is unchanged — `buildNavGroups` (shared with the command
 * palette, so the two can never disagree), one lucide icon per item, and
 * only LIVE destinations. POS and KDS never render this sidebar.
 */
export function AppSidebar({ store, staff, ...permissions }: NavPermissions & { store: SidebarStore; staff: SidebarStaff }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const reduced = useReducedMotion();
  const groups = buildNavGroups(permissions);

  // On a phone the sidebar is a sheet; navigating should close it, or the
  // new page sits behind the menu you just used.
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
    <Sidebar variant="inset" collapsible="icon" className="[&_[data-sidebar=sidebar]]:bg-sidebar">
      <SidebarHeader className="gap-2 px-2 pt-3 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-10 hover:bg-transparent hover:text-foreground group-data-[collapsible=icon]:px-0!">
              <Link href={permissions.canSeeOrders ? "/app/orders" : "/app/deliveries"} aria-label="FRYBIRD IQ home" className="gap-2.5">
                <Image src="/brand-mark.svg" alt="" width={28} height={28} className="size-7 shrink-0 rounded-[7px]" priority />
                <span className="font-heading text-[15px] font-bold tracking-[-0.01em] text-foreground">
                  FRYBIRD <span className="text-primary">IQ</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {/* The store. One today; the block is where a second one will be chosen. */}
        <div className="rounded-lg border border-border bg-surface-muted/70 px-3 py-2 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-[13.5px] font-semibold leading-tight">{store.name}</p>
          <p className="truncate text-[11.5px] leading-tight text-muted-foreground">{store.line}</p>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <ScrollArea className="h-full">
          {groups.map((group) => (
            <SidebarGroup key={group.id} className="px-2 py-1.5">
              <SidebarGroupLabel className="h-7 px-2 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={item.label}
                          asChild
                          className={cn(
                            "relative h-9 rounded-lg px-2.5 text-[13.5px] font-medium text-foreground/85 transition-colors duration-[120ms] hover:bg-surface-muted hover:text-foreground data-active:bg-sidebar-accent data-active:font-semibold data-active:text-foreground [&_svg]:text-muted-foreground data-active:[&_svg]:text-foreground",
                          )}
                        >
                          <Link href={item.href} aria-current={active ? "page" : undefined}>
                            {active && (
                              <motion.span
                                layoutId="nav-active-bar"
                                aria-hidden="true"
                                className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-primary group-data-[collapsible=icon]:hidden"
                                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }}
                              />
                            )}
                            <item.icon aria-hidden="true" className="size-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter className="border-t border-border px-3 py-3 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground" aria-hidden="true">
            {initials(staff.displayName)}
          </span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-[12.5px] font-semibold leading-tight">{staff.displayName ?? "Staff"}</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">{staff.roles.map((role) => role.charAt(0) + role.slice(1).toLowerCase()).join(" · ")}</p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
