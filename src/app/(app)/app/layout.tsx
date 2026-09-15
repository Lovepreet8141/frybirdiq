import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { getStoreHeadline } from "@/lib/repositories/org";
import { AppChrome } from "@/components/staff/app-chrome";
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
  const [
    staff,
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
    canSeeHardware,
    canSeeExports,
  ] = await Promise.all([
    getStaff(),
    staffCan("orders.view"),
    staffCan("orders.create"),
    staffCan("delivery.view"),
    staffCan("menu.view"),
    staffCan("analytics.view"),
    staffCan("customers.view"),
    staffCan("staff.manage"),
    staffCan("audit.view"),
    staffCan("finance.view"),
    staffCan("kitchen.view"),
    staffCan("settings.manage"),
    staffCan("orders.discount"),
    staffCan("inventory.view"),
    staffCan("orders.cancel"),
    // Printers: the owner configures, the device at the till tests — either may see the page.
    Promise.all([staffCan("integrations.manage"), staffCan("orders.create")]).then((flags) => flags.some(Boolean)),
    staffCan("reports.export"),
  ]);

  if (!staff) {
    // A signed-in customer who lands here is sent to their own account. Sending
    // everyone to /sign-in would bounce them between two pages that each think
    // the other is where they belong.
    const home = await resolveHome();
    redirect(home.kind === "customer" ? "/account" : "/sign-in");
  }

  // The sidebar remembers whether it was collapsed (the primitive writes
  // `sidebar_state`); reading it here means the first paint is already right.
  const sidebarState = (await cookies()).get("sidebar_state")?.value;
  const sidebarDefaultOpen = sidebarState === undefined || sidebarState === "true";

  const store = await getStoreHeadline(staff.orgId);

  return (
    /* The whole staff area is the IQ surface: light, where the customer
       site is dark. They are different rooms. */
    <div data-surface="iq" className="surface-dark flex min-h-dvh flex-col bg-background text-foreground">
      <AppChrome
        staff={{ displayName: staff.displayName, roles: staff.roles, orgId: staff.orgId }}
        store={store}
        sidebarDefaultOpen={sidebarDefaultOpen}
        permissions={{
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
          canSeeHardware,
          canSeeExports,
        }}
      >
        {children}
      </AppChrome>
    </div>
  );
}
