import type { Metadata } from "next";
import { KdsViewTabs } from "@/components/kds/kds-view-tabs";
import { ExpoBoard } from "@/components/kds/stations-boards";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listVisibleStations, loadStationOrders } from "@/lib/repositories/kitchen-stations";

export const metadata: Metadata = { title: "Kitchen expo", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** EXPO (roadmap 4.2): every live order and each station's progress; where an order is marked READY. */
export default async function ExpoPage() {
  const staff = await requireStaff();
  const [canView, canUpdate] = await Promise.all([staffCan("kitchen.view"), staffCan("kitchen.update")]);
  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="see the kitchen display" />
      </div>
    );
  }

  return (
    <div>
      <KdsViewTabs active="EXPO" stations={await listVisibleStations(staff.orgId)} />
      <ExpoBoard initial={await loadStationOrders(staff.orgId)} canUpdate={canUpdate} orgId={staff.orgId} />
    </div>
  );
}
