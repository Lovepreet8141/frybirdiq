import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/iq/menu/action-button";
import { MenuSectionNav } from "@/components/iq/menu/menu-section-nav";
import { DataTrust, Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { PageHeader } from "@/components/staff/page-header";
import { PermissionDenied } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStaff, staffCan } from "@/lib/auth";
import { publishAllDraftsAction, publishCategoryAction, publishModifierGroupAction, publishProductAction } from "@/lib/menu-admin/actions";
import { getRecentChanges, listDraftItems } from "@/lib/repositories/menu-admin";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Review changes — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  category: "Category",
  product: "Product",
  modifierGroup: "Modifier group",
  modifier: "Modifier option",
  combo: "Combo",
  availability: "Availability",
};
const KINDS = ["category", "product", "combo", "modifierGroup", "modifier", "availability"] as const;
const EDIT_PATH: Record<string, (id: string) => string> = {
  category: (id) => `/app/iq/menu/categories/${id}`,
  product: (id) => `/app/iq/menu/products/${id}`,
  modifierGroup: (id) => `/app/iq/menu/modifiers/${id}`,
};

const when = (date: Date) => date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Publishing. Everything still in draft, in one place — new categories,
 * products and modifier groups only. Editing something already live takes
 * effect on save; the activity log below is visibility of that, not an
 * undo list.
 */
export default async function MenuReviewPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.publish"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="publish menu changes" />
      </div>
    );
  }

  const { kind: kindFilter } = await searchParams;
  const [canEdit, drafts, allRecentChanges] = await Promise.all([staffCan("menu.edit"), listDraftItems(staff.orgId), getRecentChanges(staff.orgId, 100)]);
  const recentChanges = kindFilter ? allRecentChanges.filter((change) => change.entityType === kindFilter) : allRecentChanges.slice(0, 40);
  const counts = new Map<string, number>();
  for (const change of allRecentChanges) counts.set(change.entityType, (counts.get(change.entityType) ?? 0) + 1);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-[var(--gutter)] py-8">
      <PageHeader
        title="Review changes"
        description="Nothing in draft is visible on the website or the counter until it is published. Edits to live items took effect when they were saved."
        actions={
          drafts.length > 1 && (
            <ActionButton action={publishAllDraftsAction} confirmMessage={`Publish all ${drafts.length} pending items?`}>
              Publish all ({drafts.length})
            </ActionButton>
          )
        }
      />
      <MenuSectionNav current="review" draftCount={drafts.length} canEdit={canEdit} canPublish />

      <DataTrust
        items={[
          drafts.length === 0 ? { tone: "gain", text: "Nothing waiting — the menu customers see is the menu you have" } : { tone: "flag", text: `${drafts.length} ${drafts.length === 1 ? "item" : "items"} in draft, hidden from customers` },
          { tone: "neutral", text: `${allRecentChanges.length} recent ${allRecentChanges.length === 1 ? "change" : "changes"} logged` },
        ]}
      />

      <Panel>
        <PanelHeader title="Waiting to publish" description="New items nobody can see yet. Publishing makes each one live everywhere at once." meta={drafts.length > 0 ? `${drafts.length}` : undefined} />
        {drafts.length === 0 ? (
          <PanelBody className="pt-0">
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing waiting to be published.</p>
          </PanelBody>
        ) : (
          <PanelBody flush className="border-t border-border pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden sm:table-cell">Kind</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((item) => (
                  <TableRow key={`${item.kind}-${item.id}`}>
                    <TableCell>
                      <Link href={EDIT_PATH[item.kind]!(item.id)} className="font-semibold hover:underline">
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {/*
                        Three static branches, not a lookup wrapped in a closure — a
                        Server Component can only hand a Client Component a genuine
                        Server Action reference, and only `.bind()` on a statically
                        imported action is recognised as one.
                      */}
                      {item.kind === "category" && <ActionButton action={publishCategoryAction.bind(null, item.id)}>Publish</ActionButton>}
                      {item.kind === "product" && <ActionButton action={publishProductAction.bind(null, item.id)}>Publish</ActionButton>}
                      {item.kind === "modifierGroup" && <ActionButton action={publishModifierGroupAction.bind(null, item.id)}>Publish</ActionButton>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Activity log"
          description="What changed on live items, newest first. These edits already took effect — this is visibility, not an undo list."
          action={
            <nav className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-border bg-panel p-1" aria-label="Filter by kind">
              <Link href="/app/iq/menu/review" aria-current={!kindFilter ? "page" : undefined} className={cn("flex h-7 items-center rounded-[7px] px-2.5 text-[12.5px] font-medium transition-colors duration-[120ms]", !kindFilter ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>
                All
              </Link>
              {KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind) => (
                <Link
                  key={kind}
                  href={`/app/iq/menu/review?kind=${kind}`}
                  aria-current={kindFilter === kind ? "page" : undefined}
                  className={cn("flex h-7 items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-medium transition-colors duration-[120ms]", kindFilter === kind ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {KIND_LABEL[kind]}
                  <span className="tabular text-[11px] font-normal text-muted-foreground">{counts.get(kind)}</span>
                </Link>
              ))}
            </nav>
          }
        />
        {recentChanges.length === 0 ? (
          <PanelBody className="pt-0">
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">{kindFilter ? `No ${KIND_LABEL[kindFilter]?.toLowerCase() ?? kindFilter} changes recorded yet.` : "No changes recorded yet."}</p>
          </PanelBody>
        ) : (
          <PanelBody flush className="border-t border-border pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">When</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden md:table-cell">Field</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentChanges.map((change) => (
                  <TableRow key={change.id}>
                    <TableCell className="tabular hidden whitespace-nowrap text-muted-foreground sm:table-cell">{when(change.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {EDIT_PATH[change.entityType] ? (
                          <Link href={EDIT_PATH[change.entityType]!(change.entityId)} className="font-semibold hover:underline">
                            {change.entityName}
                          </Link>
                        ) : (
                          <span className="font-semibold">{change.entityName}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {KIND_LABEL[change.entityType] ?? change.entityType}
                          <span className="sm:hidden"> · {when(change.createdAt)}</span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{change.field}</TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="text-muted-foreground md:hidden">{change.field}: </span>
                      <span className="tabular text-muted-foreground line-through decoration-border-strong">{change.oldValue ?? "—"}</span>
                      <span className="text-muted-foreground"> → </span>
                      <span className="tabular font-semibold">{change.newValue ?? "—"}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        )}
      </Panel>
    </div>
  );
}
