import type { Metadata } from "next";
import { DataTrust } from "@/components/iq/ui";
import { AdminSectionNav } from "@/components/staff/admin-section-nav";
import { AuditTable } from "@/components/staff/audit-table";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { adminNavAccess } from "@/lib/auth/admin-access";
import { getAuditLog } from "@/lib/repositories/audit";

export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The general audit log (`platform.ts`'s `auditLogs`) — distinct from the
 * Menu review queue's own change log. Gated on `audit.view`, held only by
 * OWNER/ADMIN.
 */
export default async function AuditLogPage() {
  const staff = await requireStaff();
  if (!(await staffCan("audit.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view the audit log" />
      </div>
    );
  }

  const [entries, access] = await Promise.all([getAuditLog(staff.orgId), adminNavAccess()]);
  const actors = new Set(entries.map((entry) => entry.actorName ?? "System")).size;
  const oldest = entries[entries.length - 1];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Audit log" description="Sensitive actions — who did what, and when — with the exact before and after that was recorded." />
      <AdminSectionNav current="audit" access={access} />
      <DataTrust
        items={[
          { tone: "gain", text: entries.length === 0 ? "No events yet" : `Latest ${entries.length} events · ${actors} ${actors === 1 ? "actor" : "actors"}` },
          ...(oldest ? [{ tone: "neutral" as const, text: `Back to ${oldest.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}` }] : []),
        ]}
      />
      <AuditTable entries={entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }))} />
    </div>
  );
}
