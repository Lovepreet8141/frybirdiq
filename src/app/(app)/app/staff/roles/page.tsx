import type { Metadata } from "next";
import { PageHeader } from "@/components/staff/page-header";
import { RolesMatrix } from "@/components/staff/roles-matrix";
import { PermissionDenied } from "@/components/states";
import { requireStaff, staffCan } from "@/lib/auth";

export const metadata: Metadata = { title: "Roles & permissions", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A read-only render of `domain/permissions.ts` — every permission, every
 * role, and who holds it. Zero business logic of its own: it calls
 * `permissionsFor`, the exact function the server uses to authorize a
 * request, so this page can never say something the enforcement code
 * disagrees with. Roadmap 6.2. Gated on `staff.manage`, same as the staff
 * roster this page is reached from.
 */
export default async function RolesPage() {
  await requireStaff();
  const canManage = await staffCan("staff.manage");

  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="view roles and permissions" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader title="Roles & permissions" description="Every role at FRYBIRD and exactly what it can do." />
      <RolesMatrix />
    </div>
  );
}
