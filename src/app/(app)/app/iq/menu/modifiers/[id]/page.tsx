import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listModifierGroupsAdmin } from "@/lib/repositories/menu-admin";
import { ModifierGroupForm } from "@/components/iq/menu/modifier-group-form";
import { ModifierList } from "@/components/iq/menu/modifier-list";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { Badge } from "@/components/ui/badge";

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
    <div className="mx-auto w-full max-w-3xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu/modifiers" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Modifier groups
      </Link>

      <div className="mt-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{group.name}</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={group.status === "DRAFT" ? "warning" : "success"}>{group.status === "DRAFT" ? "Draft" : "Live"}</Badge>
          {group.status === "DRAFT" ? "Not visible until published." : "Visible to the website and the counter."}
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <Panel>
          <PanelHeader title="Group settings" description="Name, identity and how many options a customer must pick." />
          <PanelBody className="pt-0">
            <ModifierGroupForm id={id} initial={group} />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Options" description="What this group offers, and the order they show in. Drag to reorder." meta={String(group.modifiers.length)} />
          <PanelBody className="pt-0">
            <ModifierList groupId={id} modifiers={group.modifiers} />
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
