import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionButton } from "@/components/iq/menu/action-button";
import { MenuSectionNav } from "@/components/iq/menu/menu-section-nav";
import { DataTrust } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { EmptyState, PermissionDenied } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaff, staffCan } from "@/lib/auth";
import { deleteModifierGroupAction, publishModifierGroupAction } from "@/lib/menu-admin/actions";
import { formatINR } from "@/lib/money";
import { listDraftItems, listModifierGroupsAdmin } from "@/lib/repositories/menu-admin";

export const metadata: Metadata = { title: "Modifiers — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function rules(min: number, max: number | null): string {
  if (min === 0 && max === null) return "Any number, optional";
  if (min === 0) return `Up to ${max}, optional`;
  if (max === null) return `At least ${min}`;
  if (min === max) return min === 1 ? "Exactly one" : `Exactly ${min}`;
  return `${min}–${max}`;
}

/**
 * Modifier groups — every option set a product can carry, with its rules
 * and status. Rows link to the group's editor; publish and delete are the
 * same server actions the editor uses, re-checked on the server.
 */
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

  const [canEdit, canPublish, groups, drafts] = await Promise.all([staffCan("menu.edit"), staffCan("menu.publish"), listModifierGroupsAdmin(staff.orgId), listDraftItems(staff.orgId)]);
  const options = groups.reduce((sum, group) => sum + group.modifiers.length, 0);
  const draftGroups = groups.filter((group) => group.status === "DRAFT").length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Modifiers"
        description="Option sets a product can carry — sizes, sauces, extras — and the rules for choosing them. A price delta here is added at pricing time, never typed into a product."
        actions={
          canEdit && (
            <Button variant="inverse" asChild>
              <Link href="/app/iq/menu/modifiers/new">
                <Plus data-icon="inline-start" aria-hidden="true" />
                New group
              </Link>
            </Button>
          )
        }
      />
      <MenuSectionNav current="modifiers" draftCount={drafts.length} canEdit={canEdit} canPublish={canPublish} />

      <DataTrust
        items={[
          { tone: "gain", text: `${groups.length} ${groups.length === 1 ? "group" : "groups"} · ${options} ${options === 1 ? "option" : "options"}` },
          ...(draftGroups > 0 ? [{ tone: "flag" as const, text: `${draftGroups} in draft — not on the menu until published` }] : []),
        ]}
      />

      {groups.length === 0 ? (
        <EmptyState
          title="No modifier groups yet"
          detail="Create a group such as “Spice level” or “Add-ons”, add its options, then attach it to products from each product's Modifiers tab."
          action={
            canEdit ? (
              <Button variant="inverse" asChild>
                <Link href="/app/iq/menu/modifiers/new">
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Create the first group
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead className="hidden md:table-cell">Options</TableHead>
                <TableHead className="hidden sm:table-cell">Rule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const priced = group.modifiers.filter((modifier) => modifier.priceDelta !== 0n);
                const preview = group.modifiers
                  .slice(0, 3)
                  .map((modifier) => modifier.name)
                  .join(", ");
                return (
                  <TableRow key={group.id}>
                    <TableCell>
                      <Link href={`/app/iq/menu/modifiers/${group.id}`} className="flex flex-col gap-0.5 hover:underline">
                        <span className="font-semibold">{group.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {group.modifiers.length} {group.modifiers.length === 1 ? "option" : "options"}
                          {priced.length > 0 && ` · ${priced.length} with a price`}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden max-w-[320px] truncate text-muted-foreground md:table-cell">
                      {preview}
                      {group.modifiers.length > 3 && ` +${group.modifiers.length - 3}`}
                      {group.modifiers.length === 0 && "No options yet"}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{rules(group.minSelections, group.maxSelections)}</TableCell>
                    <TableCell>
                      <Badge variant={group.status === "DRAFT" ? "warning" : "success"}>{group.status === "DRAFT" ? "Draft" : "Live"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {group.status === "DRAFT" && canPublish && <ActionButton action={publishModifierGroupAction.bind(null, group.id)}>Publish</ActionButton>}
                        {canEdit && (
                          <ActionButton action={deleteModifierGroupAction.bind(null, group.id)} variant="destructive" confirmMessage={`Delete "${group.name}"? Products using it lose the option set.`}>
                            Delete
                          </ActionButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {groups.some((group) => group.modifiers.some((modifier) => modifier.priceDelta !== 0n)) && (
        <p className="text-[12.5px] text-muted-foreground">
          Priced options add their delta at pricing time — for example {formatINR(groups.flatMap((group) => group.modifiers).find((modifier) => modifier.priceDelta !== 0n)!.priceDelta)} on top of the listed price.
        </p>
      )}
    </div>
  );
}
