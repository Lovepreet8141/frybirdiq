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

const KIND_LABEL: Record<string, string> = {
  category: "Category",
  product: "Product",
  modifierGroup: "Modifier group",
  modifier: "Modifier option",
  combo: "Combo",
  availability: "Availability",
};
const EDIT_PATH: Record<string, (id: string) => string> = {
  category: (id) => `/app/iq/menu/categories/${id}`,
  product: (id) => `/app/iq/menu/products/${id}`,
  modifierGroup: (id) => `/app/iq/menu/modifiers/${id}`,
};

/**
 * Everything still in draft, in one place — new categories, products and
 * modifier groups only. Editing something already live takes effect
 * immediately on save; this list is exclusively "not visible to anyone yet".
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
  const [drafts, allRecentChanges] = await Promise.all([listDraftItems(staff.orgId), getRecentChanges(staff.orgId, 100)]);
  const recentChanges = kindFilter ? allRecentChanges.filter((c) => c.entityType === kindFilter) : allRecentChanges.slice(0, 40);

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
              {/*
                Three static branches, not a dynamic `PUBLISH_ACTION[item.kind]`
                lookup wrapped in a closure — a Server Component can only pass a
                genuine Server Action reference to a Client Component's prop, and
                only `.bind()` called directly on a statically-imported action is
                recognised as one. A Record lookup, or any arrow function that
                wraps the call, is just a plain closure to the RSC serializer and
                crashes the render. See src/lib/menu-admin/actions.ts.
              */}
              {item.kind === "category" && <ActionButton action={publishCategoryAction.bind(null, item.id)}>Publish</ActionButton>}
              {item.kind === "product" && <ActionButton action={publishProductAction.bind(null, item.id)}>Publish</ActionButton>}
              {item.kind === "modifierGroup" && <ActionButton action={publishModifierGroupAction.bind(null, item.id)}>Publish</ActionButton>}
            </li>
          ))
        )}
      </ul>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-bold">Activity log</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              A real log of what changed on already-live items — not a staging system. These edits already took effect the moment they were saved; this is visibility, not an undo list.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-sm">
            <Link href="/app/iq/menu/review" className={`rounded-md border px-2.5 py-1 ${!kindFilter ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-surface-muted"}`}>
              All
            </Link>
            {(["category", "product", "combo", "modifierGroup", "modifier", "availability"] as const).map((k) => (
              <Link
                key={k}
                href={`/app/iq/menu/review?kind=${k}`}
                className={`rounded-md border px-2.5 py-1 ${kindFilter === k ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-surface-muted"}`}
              >
                {KIND_LABEL[k]}
              </Link>
            ))}
          </div>
        </div>
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
