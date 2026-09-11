"use client";

import Link from "next/link";
import {
  deleteCategoryAction,
  moveCategoryAction,
  publishCategoryAction,
  setCategoryActiveAction,
} from "@/lib/menu-admin/actions";
import type { CategoryAdminRow } from "@/lib/repositories/menu-admin";
import { ActionButton } from "./action-button";

export function CategoryRow({ category, canPublish }: { category: CategoryAdminRow; canPublish: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/app/iq/menu/categories/${category.id}`} className="font-semibold hover:underline">
            {category.name}
          </Link>
          {category.status === "DRAFT" && (
            <span className="rounded-full bg-[var(--warning)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">Draft</span>
          )}
          {!category.isActive && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Archived</span>}
        </div>
        <p className="text-sm text-muted-foreground">
          {category.productCount} {category.productCount === 1 ? "product" : "products"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ActionButton action={() => moveCategoryAction(category.id, "up")} variant="ghost">
          ↑
        </ActionButton>
        <ActionButton action={() => moveCategoryAction(category.id, "down")} variant="ghost">
          ↓
        </ActionButton>
        {category.status === "DRAFT" && canPublish && (
          <ActionButton action={() => publishCategoryAction(category.id)}>Publish</ActionButton>
        )}
        <ActionButton action={() => setCategoryActiveAction(category.id, !category.isActive)} variant="ghost">
          {category.isActive ? "Archive" : "Restore"}
        </ActionButton>
        <ActionButton
          action={() => deleteCategoryAction(category.id)}
          variant="destructive"
          confirmMessage={`Delete "${category.name}"? This cannot be undone.`}
        >
          Delete
        </ActionButton>
      </div>
    </li>
  );
}
