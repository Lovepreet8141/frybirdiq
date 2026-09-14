import type { Metadata } from "next";
import { ActivityFeed } from "@/components/staff/activity-feed";
import { LiveRefresh } from "@/components/staff/live-refresh";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listRecentOrderEvents } from "@/lib/repositories/activity";

export const metadata: Metadata = { title: "Activity", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REFRESH_MS = 30_000;

/**
 * COMMAND CENTER › Activity. Every order status change, who made it and
 * when, straight from the append-only `order_events` history. Read-only,
 * under the same `analytics.view` gate as the rest of the Command Center.
 */
export default async function ActivityPage() {
  const staff = await requireStaff();
  if (!(await staffCan("analytics.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view activity" />
      </div>
    );
  }

  const events = await listRecentOrderEvents(staff.orgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <LiveRefresh orgId={staff.orgId} fallbackMs={REFRESH_MS} />
      <PageHeader
        title="Activity"
        description={`The last ${events.length} order events — who moved what, and when. Updates as orders move.`}
      />
      <ActivityFeed events={events.map((event) => ({ ...event, at: event.at.toISOString() }))} />
    </div>
  );
}
