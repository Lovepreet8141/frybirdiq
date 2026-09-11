import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { getRecentChanges, listDraftItems } from "@/lib/repositories/menu-admin";
import { ActionButton } from "@/components/iq/menu/action-button";
import { PermissionDenied } from "@/components/states";
import { publishAllDraftsAction, publishCategoryAction, publishModifierGroupAction, publishProductAction } from "@/lib/menu-admin/actions";

export const metadata: Metadata = { title: "Review changes — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { category: "Category", product: "Product", modifierGroup: "Modifier group", availability: "Availability" };
const EDIT_PATH: Record<string, (id: string) => string> = {
  category: (id) => `/app/iq/menu/categories/${id}`,
  product: (id) => `/app/iq/menu/products/${id}`,
  modifierGroup: (id) => `/app/iq/menu/modifiers/${id}`,
};
const PUBLISH_ACTION: Record<string, (id: string) => Promise<{ ok: boolean; error?: string }>> = {
  category: publishCategoryAction,
  product: publishProductAction,
  modifierGroup: publishModifierGroupAction,
};

/**
 * Everything still in draft, in one place — new categories, products and
 * modifier groups only. Editing something already live takes effect
 * immediately on save; this list is exclusively "not visible to anyone yet".
 */
export default async function MenuReviewPage() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  if (!(await staffCan("menu.publish"))) {
    return (
      <div className="mx-auto w-full max-w-lg px-[var(--gutter)] py-16">
        <PermissionDenied action="publish menu changes" />
      </div>
    );
  }

  const [drafts, recentChanges] = await Promise.all([listDraftItems(staff.orgId), getRecentChanges(staff.orgId, 40)]);

  return (
    <div className="mx-auto w-full max-w-2xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Control Center
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Review changes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Nothing below is visible on the website or the counter until you publish it.</p>
        </div>
        {drafts.length > 1 && (
          <ActionButton action={publishAllDraftsAction} confirmMessage={`Publish all ${drafts.length} pending items?`}>
            Publish all ({drafts.length})
          </ActionButton>
        )}
      </div>

      <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface px-4">
        {drafts.length === 0 ? (
          <li className="py-8 text-center text-sm text-muted-foreground">Nothing waiting to be published.</li>
        ) : (
          drafts.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 py-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{KIND_LABEL[item.kind]}</span>
                <Link href={EDIT_PATH[item.kind]!(item.id)} className="block font-semibold hover:underline">
                  {item.name}
                </Link>
              </div>
              <ActionButton action={() => PUBLISH_ACTION[item.kind]!(item.id)}>Publish</ActionButton>
            </li>
          ))
        )}
      </ul>

      <section className="mt-8">
        <h2 className="font-heading text-lg font-bold">Recent changes</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          A real log of what changed on already-live items — not a staging system. These edits already took effect the moment they were saved; this is visibility, not an undo list.
        </p>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface px-4">
          {recentChanges.length === 0 ? (
            <li className="py-8 text-center text-sm text-muted-foreground">No changes recorded yet.</li>
          ) : (
            recentChanges.map((change) => (
              <li key={change.id} className="flex flex-col gap-0.5 py-3 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{KIND_LABEL[change.entityType] ?? change.entityType}</span>
                  <span className="font-semibold">{change.entityName}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{change.createdAt.toLocaleString("en-IN")}</span>
                </span>
                <span className="text-muted-foreground">
                  {change.field}: <span className="tabular">{change.oldValue ?? "—"}</span> → <span className="tabular font-semibold text-foreground">{change.newValue ?? "—"}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
