import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listModifierGroupsAdmin } from "@/lib/repositories/menu-admin";
import { ModifierGroupForm } from "@/components/iq/menu/modifier-group-form";
import { ModifierList } from "@/components/iq/menu/modifier-list";

export const metadata: Metadata = { title: "Edit modifier group — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditModifierGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.view"))) redirect("/app/iq/menu/modifiers");

  const { id } = await params;
  const groups = await listModifierGroupsAdmin(staff.orgId);
  const group = groups.find((g) => g.id === id);
  if (!group) notFound();

  return (
    <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu/modifiers" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Modifier groups
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-bold tracking-tight">{group.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{group.status === "DRAFT" ? "Draft — not visible yet." : "Live."}</p>

      <div className="mt-6 flex flex-col gap-6">
        <ModifierGroupForm id={id} initial={group} />

        <div className="border-t border-border pt-6">
          <h2 className="font-heading text-lg font-bold">Options</h2>
          <div className="mt-3">
            <ModifierList groupId={id} modifiers={group.modifiers} />
          </div>
        </div>
      </div>
    </div>
  );
}
