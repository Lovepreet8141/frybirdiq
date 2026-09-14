import type { Metadata } from "next";
import { CommandCenterNav } from "@/components/iq/command-center-nav";
import { DataTrust } from "@/components/iq/ui";
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
  const oldest = events[events.length - 1];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <LiveRefresh orgId={staff.orgId} fallbackMs={REFRESH_MS} />
      <PageHeader title="Activity" description="Every order status change — who moved what, and when — from the append-only order history." />
      <CommandCenterNav current="activity" />
      <DataTrust
        items={[
          { tone: "gain", text: `Latest ${events.length} events · updates as orders move` },
          ...(oldest ? [{ tone: "neutral" as const, text: `Back to ${oldest.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST` }] : []),
        ]}
      />
      <ActivityFeed events={events.map((event) => ({ ...event, at: event.at.toISOString() }))} />
    </div>
  );
}
