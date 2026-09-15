import type { Metadata } from "next";
import { PageHeader } from "@/components/staff/page-header";
import { StaffTable } from "@/components/staff/staff-table";
import { InviteStaffForm } from "@/components/staff/invite-staff-form";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";
import { ROLES, canGrantRole } from "@/domain/permissions";
import { listStaff } from "@/lib/repositories/staff";

export const metadata: Metadata = { title: "Staff", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The staff roster: invite, deactivate, change role. Roadmap 6.1. Gated on
 * `staff.manage`, same permission that already governs who this list even
 * makes sense to show.
 *
 * `grantableRoles` — this account's `canGrantRole` ceiling — is resolved
 * once, here, and threaded into both the invite form and every row's
 * actions, so the two screens can never disagree about what this signed-in
 * account is allowed to hand out.
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

  const grantableRoles = ROLES.filter((role) => canGrantRole(staff.roles, role));
  const roster = await listStaff(staff.orgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Staff" description="Everyone with an account at FRYBIRD, and what they can do." />
      <InviteStaffForm roles={grantableRoles} />
      <StaffTable
        staff={roster.map((member) => ({ ...member, joinedAt: member.joinedAt.toISOString() }))}
        actorUserId={staff.userId}
        grantableRoles={grantableRoles}
      />
    </div>
  );
}
