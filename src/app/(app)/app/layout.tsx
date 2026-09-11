import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getStaff, staffCan } from "@/lib/auth";
import { signOut } from "@/lib/auth/actions";
import { NewOrderAlert } from "@/components/staff/new-order-alert";
import { SoundCheck } from "@/components/staff/sound-check";
import { resolveHome } from "@/lib/auth/route-home";

/**
 * The staff portal shell. BUILD-PLAN.md §9: "Use route-level authorization."
 *
 * The gate is here, in a Server Component, not in middleware. Middleware runs
 * on a matcher and cannot see whether this person holds a membership of this
 * organization — an authenticated stranger would sail through it. Every screen
 * inside this layout is behind this check, and every action re-checks its own
 * permission because rendering a screen is not authorization for the actions
 * on it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [staff, canSeeOrders, canSeePos, canSeeDeliveries, canSeeAnalytics, canReject] = await Promise.all([
    getStaff(),
    staffCan("orders.view"),
    staffCan("orders.create"),
    staffCan("delivery.view"),
    staffCan("analytics.view"),
    staffCan("orders.cancel"),
  ]);

  if (!staff) {
    // A signed-in customer who lands here is sent to their own account. Sending
    // everyone to /sign-in would bounce them between two pages that each think
    // the other is where they belong.
    const home = await resolveHome();
    redirect(home.kind === "customer" ? "/account" : "/sign-in");
  }

  return (
    /* The whole staff area is the IQ surface: light, where the customer
       site is dark. They are different rooms. */
    <div data-surface="iq" className="surface-dark flex min-h-full flex-col bg-background text-foreground">
      <header className="border-b border-border print:hidden">
        <div className="mx-auto flex h-[68px] w-full max-w-6xl items-center justify-between gap-4 px-[var(--gutter)]">
          <div className="flex items-center gap-2 sm:gap-6">
            <Link
              href={canSeeOrders ? "/app/orders" : "/app/deliveries"}
              className="flex min-h-[44px] items-center font-heading text-lg font-bold tracking-tight"
            >
              FRYBIRD <span className="text-primary">IQ</span>
            </Link>

            {/* Nav follows permissions: a rider sees deliveries and nothing else. */}
            <nav className="flex items-center gap-1" aria-label="Sections">
              {canSeeOrders && (
                <Link
                  href="/app/orders"
                  className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  Orders
                </Link>
              )}
              {canSeePos && (
                <Link
                  href="/app/pos"
                  className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  POS
                </Link>
              )}
              {canSeeDeliveries && (
                <Link
                  href="/app/deliveries"
                  className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  Deliveries
                </Link>
              )}
              {canSeeAnalytics && (
                <Link
                  href="/app/iq"
                  className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  IQ
                </Link>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {staff.displayName}
              <span className="ml-2 text-xs uppercase tracking-[0.08em]">{staff.roles.join(" · ")}</span>
            </span>
            {canSeeOrders && <SoundCheck />}

            <form action={signOut}>
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

      {/* Above the content, so an order that has arrived is the first thing
          seen rather than something to scroll for. Hidden on print — a
          kitchen ticket printing must never pop this dialog onto paper. */}
      {canSeeOrders && (
        <div className="print:hidden">
          <NewOrderAlert canReject={canReject} />
        </div>
      )}

      <main className="flex-1">{children}</main>
    </div>
  );
}
