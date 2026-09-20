import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KdsViewTabs } from "@/components/kds/kds-view-tabs";
import { StationBoard } from "@/components/kds/stations-boards";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { parseStation } from "@/lib/kitchen/stations";
import { loadStationOrders } from "@/lib/repositories/kitchen-stations";

export const metadata: Metadata = { title: "Kitchen station", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** One station's screen (roadmap 4.2). `kitchen.view` gates it; marking a line is `kitchen.update`, re-checked in the action. */
export default async function StationPage({ params }: { params: Promise<{ station: string }> }) {
  const station = parseStation((await params).station);
  if (!station) notFound();

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
      <KdsViewTabs active={station} />
      <StationBoard station={station} initial={await loadStationOrders(staff.orgId)} canUpdate={canUpdate} orgId={staff.orgId} />
    </div>
  );
}
