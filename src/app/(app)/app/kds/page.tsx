import type { Metadata } from "next";
import { KdsViewTabs } from "@/components/kds/kds-view-tabs";
import { KdsBoard } from "@/components/kds/kds-board";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { loadKitchenTickets } from "@/lib/repositories/kitchen-board";
import { listVisibleStations } from "@/lib/repositories/kitchen-stations";

export const metadata: Metadata = { title: "Kitchen", robots: { index: false, follow: false } };

// A kitchen screen: always the live board, never a cached one.
export const dynamic = "force-dynamic";

/**
 * The kitchen display. BUILD-PLAN.md Phase 6, foundation only — no
 * stations, no routing, because the domain has neither yet and inventing
 * them here is an architectural decision, not a screen.
 *
 * `kitchen.view` gates the board; moving a ticket is re-checked against
 * `kitchen.update` inside `advanceOrderAction` on every press, so a screen
 * that shows a button is never what authorises it. §41.
 */
export default async function KdsPage() {
  const staff = await requireStaff();
  const [canView, canUpdate] = await Promise.all([staffCan("kitchen.view"), staffCan("kitchen.update")]);

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="see the kitchen display" />
      </div>
    );
  }

  const [tickets, stations] = await Promise.all([loadKitchenTickets(staff.orgId), listVisibleStations(staff.orgId)]);

  return (
    <div>
      <KdsViewTabs active="ALL" stations={stations} />
      <div className="lg:h-[calc(100dvh-68px-61px)]">
        <KdsBoard initial={tickets} canUpdate={canUpdate} orgId={staff.orgId} />
      </div>
    </div>
  );
}
