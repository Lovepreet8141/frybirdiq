import type { Metadata } from "next";
import { PageHeader } from "@/components/staff/page-header";
import { StaffTable } from "@/components/staff/staff-table";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { listStaff } from "@/lib/repositories/staff";

export const metadata: Metadata = { title: "Staff", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The staff roster. Read-only — see `lib/repositories/staff.ts` for why
 * invite/edit/deactivate aren't here yet. Gated on `staff.manage`, same
 * permission that already governs who this list even makes sense to show.
 */
export default async function StaffPage() {
  const staff = await requireStaff();
  const canManage = await staffCan("staff.manage");

  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view staff" />
      </div>
    );
  }

  const roster = await listStaff(staff.orgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Staff" description="Everyone with an account at FRYBIRD, and what they can do." />
      <StaffTable staff={roster.map((member) => ({ ...member, joinedAt: member.joinedAt.toISOString() }))} />
    </div>
  );
}
