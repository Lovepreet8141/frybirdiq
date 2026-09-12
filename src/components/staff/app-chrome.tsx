"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { AppNavLink } from "@/components/staff/app-nav-link";
import { AppSidebar } from "@/components/staff/app-sidebar";
import { CommandPalette } from "@/components/staff/command-palette";
import { NewOrderAlert } from "@/components/staff/new-order-alert";
import { buildNavGroups } from "@/components/staff/nav-items";
import { SectionBreadcrumb } from "@/components/staff/section-breadcrumb";
import { SoundCheck } from "@/components/staff/sound-check";
import { UserMenu } from "@/components/staff/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
export function AppChrome({ staff, permissions, children }: { staff: StaffSummary; permissions: Permissions; children: React.ReactNode }) {
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
    canReject,
  } = permissions;

  // POS and the kitchen display: touch/speed screens that should not spend
  // 16rem of width on navigation chrome.
  const isFullBleed = pathname.startsWith("/app/pos") || pathname.startsWith("/app/kds");

  if (isFullBleed) {
    return (
      <>
        <header className="border-b border-border print:hidden">
          <div className="mx-auto flex h-[68px] w-full max-w-6xl items-center justify-between gap-4 px-[var(--gutter)]">
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
                  className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface"
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
  });

  return (
    <SidebarProvider className="min-h-full flex-1">
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
      />
      <SidebarInset>
        <header className="flex h-[68px] items-center gap-3 border-b border-border px-[var(--gutter)] print:hidden">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <SectionBreadcrumb />
          <div className="ml-auto flex items-center gap-3">
            <CommandPalette groups={navGroups} />
            {canSeeOrders && <SoundCheck />}
            <UserMenu displayName={staff.displayName} roles={staff.roles} />
          </div>
        </header>

        {canSeeOrders && (
          <div className="print:hidden">
            <NewOrderAlert canReject={canReject} />
          </div>
        )}

        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
