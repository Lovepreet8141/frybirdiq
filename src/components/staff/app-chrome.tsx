"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { AppNavLink } from "@/components/staff/app-nav-link";
import { AppSidebar } from "@/components/staff/app-sidebar";
import { NewOrderAlert } from "@/components/staff/new-order-alert";
import { SoundCheck } from "@/components/staff/sound-check";
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
  const { canSeeOrders, canSeePos, canSeeDeliveries, canSeeMenu, canSeeAnalytics, canReject } = permissions;

  const isFullBleed = pathname.startsWith("/app/pos");

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

  return (
    <SidebarProvider className="min-h-full flex-1">
      <AppSidebar
        canSeeOrders={canSeeOrders}
        canSeePos={canSeePos}
        canSeeDeliveries={canSeeDeliveries}
        canSeeMenu={canSeeMenu}
        canSeeAnalytics={canSeeAnalytics}
      />
      <SidebarInset>
        <header className="flex h-[68px] items-center justify-between gap-4 border-b border-border px-[var(--gutter)] print:hidden">
          <SidebarTrigger />
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
