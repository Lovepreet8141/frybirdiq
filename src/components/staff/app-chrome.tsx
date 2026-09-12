"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { AppNavLink } from "@/components/staff/app-nav-link";
import { AppSidebar } from "@/components/staff/app-sidebar";
import { NewOrderAlert } from "@/components/staff/new-order-alert";
import { buildNavGroups } from "@/components/staff/nav-items";
import { SiteHeader } from "@/components/staff/site-header";
import { SoundCheck } from "@/components/staff/sound-check";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { Role } from "@/domain/permissions";

interface StaffSummary {
  readonly displayName: string | null;
  readonly roles: readonly Role[];
}

interface Permissions {
  readonly canSeeOrders: boolean;
  readonly canSeePos: boolean;
  readonly canSeeDeliveries: boolean;
  readonly canSeeMenu: boolean;
  readonly canSeeAnalytics: boolean;
  readonly canSeeCustomers: boolean;
  readonly canSeeStaff: boolean;
  readonly canSeeAudit: boolean;
  readonly canSeeFinance: boolean;
  readonly canSeeKitchen: boolean;
  readonly canSeeSettings: boolean;
  readonly canSeePromotions: boolean;
  readonly canSeeInventory: boolean;
  readonly canReject: boolean;
}

/**
 * Picks the shell: sidebar for admin/operations screens, today's plain
 * header for POS (and, later, KDS) — unchanged, not full-bleed-with-nothing.
 * A cashier still needs to see who's signed in, hear a new order, and sign
 * out; what they don't need is 16rem of navigation chrome eating into a
 * touch grid. `usePathname` lives here, in the one place that needs it, same
 * reasoning as `AppNavLink` already documents for itself.
 */
export function AppChrome({
  staff,
  permissions,
  sidebarDefaultOpen,
  children,
}: {
  staff: StaffSummary;
  permissions: Permissions;
  /** Read from the `sidebar_state` cookie by the layout, so a collapsed sidebar stays collapsed across loads without a flash. */
  sidebarDefaultOpen: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const {
    canSeeOrders,
    canSeePos,
    canSeeDeliveries,
    canSeeMenu,
    canSeeAnalytics,
    canSeeCustomers,
    canSeeStaff,
    canSeeAudit,
    canSeeFinance,
    canSeeKitchen,
    canSeeSettings,
    canSeePromotions,
    canSeeInventory,
    canReject,
  } = permissions;

  // POS and the kitchen display: touch/speed screens that should not spend
  // 16rem of width on navigation chrome.
  const isFullBleed = pathname.startsWith("/app/pos") || pathname.startsWith("/app/kds");

  if (isFullBleed) {
    return (
      <>
        <header className="border-b border-border print:hidden">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-[var(--gutter)]">
            <div className="flex items-center gap-2 sm:gap-6">
              <Link
                href={canSeeOrders ? "/app/orders" : "/app/deliveries"}
                className="flex min-h-[44px] items-center font-heading text-lg font-bold tracking-tight"
              >
                FRYBIRD <span className="text-primary">IQ</span>
              </Link>
              <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Sections">
                {canSeeOrders && <AppNavLink href="/app/orders">Orders</AppNavLink>}
                {canSeePos && <AppNavLink href="/app/pos">POS</AppNavLink>}
                {canSeeKitchen && <AppNavLink href="/app/kds">Kitchen</AppNavLink>}
                {canSeeDeliveries && <AppNavLink href="/app/deliveries">Deliveries</AppNavLink>}
                {canSeeMenu && <AppNavLink href="/app/iq/menu">Menu</AppNavLink>}
                {canSeeAnalytics && (
                  <AppNavLink href="/app/iq" exclude="/app/iq/menu">
                    IQ
                  </AppNavLink>
                )}
              </nav>
            </div>

            <div className="flex items-center gap-4">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {staff.displayName}
                <span className="ml-2 text-xs uppercase tracking-[0.08em]">{staff.roles.join(" · ")}</span>
              </span>
              {canSeeOrders && <SoundCheck />}
              <form action="/api/auth/sign-out" method="POST">
                <button
                  type="submit"
                  className="flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-md border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>

        {canSeeOrders && (
          <div className="print:hidden">
            <NewOrderAlert canReject={canReject} />
          </div>
        )}

        <main className="flex-1">{children}</main>
      </>
    );
  }

  const navGroups = buildNavGroups({
    canSeeOrders,
    canSeePos,
    canSeeDeliveries,
    canSeeMenu,
    canSeeAnalytics,
    canSeeCustomers,
    canSeeStaff,
    canSeeAudit,
    canSeeFinance,
    canSeeKitchen,
    canSeeSettings,
    canSeePromotions,
    canSeeInventory,
  });

  return (
    <SidebarProvider
      defaultOpen={sidebarDefaultOpen}
      className="min-h-full flex-1"
      style={
        {
          // The kit's measurements (components/layout: (auth)/layout.tsx),
          // as spacing multiples so they scale with the root font size.
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 14)",
          "--content-padding": "calc(var(--spacing) * 6)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        canSeeOrders={canSeeOrders}
        canSeePos={canSeePos}
        canSeeDeliveries={canSeeDeliveries}
        canSeeMenu={canSeeMenu}
        canSeeAnalytics={canSeeAnalytics}
        canSeeCustomers={canSeeCustomers}
        canSeeStaff={canSeeStaff}
        canSeeAudit={canSeeAudit}
        canSeeFinance={canSeeFinance}
        canSeeKitchen={canSeeKitchen}
        canSeeSettings={canSeeSettings}
        canSeePromotions={canSeePromotions}
        canSeeInventory={canSeeInventory}
      />
      <SidebarInset>
        <SiteHeader groups={navGroups} canSeeOrders={canSeeOrders} staff={staff} />

        {canSeeOrders && (
          <div className="print:hidden">
            <NewOrderAlert canReject={canReject} />
          </div>
        )}

        {/* `SidebarInset` is already the <main>; this is the kit's content
            column. Pages keep their own gutter and max-width for now, so no
            `--content-padding` here or every screen would double up. */}
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
