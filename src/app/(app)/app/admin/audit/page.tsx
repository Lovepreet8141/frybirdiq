import type { Metadata } from "next";
import { AuditTable } from "@/components/staff/audit-table";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { getAuditLog } from "@/lib/repositories/audit";

export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The general audit log (`platform.ts`'s `auditLogs`) — distinct from the
 * Menu review queue's own change log, which already has its own UI. Gated
 * on `audit.view`, held only by OWNER/ADMIN.
 */
export default async function AuditLogPage() {
  const staff = await requireStaff();
  const canView = await staffCan("audit.view");

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view the audit log" />
      </div>
    );
  }

  const entries = await getAuditLog(staff.orgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Audit log" description="Sensitive actions — who did what, and when." />
      <AuditTable entries={entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }))} />
    </div>
  );
}
