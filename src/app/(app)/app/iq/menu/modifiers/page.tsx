import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listModifierGroupsAdmin } from "@/lib/repositories/menu-admin";
import { PermissionDenied } from "@/components/states";
import { ActionButton } from "@/components/iq/menu/action-button";
import { deleteModifierGroupAction, publishModifierGroupAction } from "@/lib/menu-admin/actions";

export const metadata: Metadata = { title: "Modifiers — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ModifiersPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="manage the menu" />
      </div>
    );
  }

  const canEdit = await staffCan("menu.edit");
  const canPublish = await staffCan("menu.publish");
  const groups = await listModifierGroupsAdmin(staff.orgId);

  return (
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Control Center
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Modifier groups</h1>
        {canEdit && (
          <Link href="/app/iq/menu/modifiers/new" className="inline-flex min-h-[40px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            + New group
          </Link>
        )}
      </div>

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface px-4">
        {groups.length === 0 ? (
          <li className="py-8 text-center text-sm text-muted-foreground">No modifier groups yet.</li>
        ) : (
          groups.map((group) => (
            <li key={group.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <Link href={`/app/iq/menu/modifiers/${group.id}`} className="font-semibold hover:underline">
                  {group.name}
                </Link>
                {group.status === "DRAFT" && <span className="ml-2 rounded-full bg-[var(--warning)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">Draft</span>}
                <p className="text-sm text-muted-foreground">{group.modifiers.length} options</p>
              </div>
              <div className="flex items-center gap-1.5">
                {group.status === "DRAFT" && canPublish && <ActionButton action={publishModifierGroupAction.bind(null, group.id)}>Publish</ActionButton>}
                <ActionButton action={deleteModifierGroupAction.bind(null, group.id)} variant="destructive" confirmMessage={`Delete "${group.name}"?`}>
                  Delete
                </ActionButton>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
