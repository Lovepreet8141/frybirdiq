import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, staffCan } from "@/lib/auth";
import { listDraftItems } from "@/lib/repositories/menu-admin";
import { ActionButton } from "@/components/iq/menu/action-button";
import { PermissionDenied } from "@/components/states";
import { publishCategoryAction, publishModifierGroupAction, publishProductAction } from "@/lib/menu-admin/actions";

export const metadata: Metadata = { title: "Review changes — FRYBIRD IQ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { category: "Category", product: "Product", modifierGroup: "Modifier group" };
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

  const drafts = await listDraftItems(staff.orgId);

  return (
    <div className="mx-auto w-full max-w-2xl px-[var(--gutter)] py-8">
      <Link href="/app/iq/menu" className="text-sm text-muted-foreground underline underline-offset-2">
        ← Menu Manager
      </Link>
      <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight">Review changes</h1>
      <p className="mt-1 text-sm text-muted-foreground">Nothing here is visible on the website or the counter until you publish it.</p>

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
    </div>
  );
}
