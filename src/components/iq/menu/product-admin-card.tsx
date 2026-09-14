"use client";

import Image from "next/image";
import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { formatINR } from "@/lib/money";
import {
  duplicateProductAction,
  moveProductPositionAction,
  moveProductToCategoryAction,
  publishProductAction,
  quickMarkAvailableAction,
  setProductActiveAction,
} from "@/lib/menu-admin/actions";
import type { ProductAdminRow } from "@/lib/repositories/menu-admin";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { cn } from "@/lib/utils";
import { AvailabilityBadge } from "./availability-badge";
import { QuickAvailabilityDialog } from "./quick-availability-dialog";

const MENU_ITEM = "flex w-full items-center px-3 py-2 text-left text-[13px] transition-colors duration-[120ms] hover:bg-muted disabled:opacity-50";

export function ProductAdminCard({
  product,
  categories,
  canPublish,
  showCategoryName,
  selected = false,
  onToggleSelect,
}: {
  product: ProductAdminRow;
  categories: readonly { id: string; name: string }[];
  canPublish: boolean;
  showCategoryName: boolean;
  /** Ticked for a bulk action. Only rendered when `onToggleSelect` is given, i.e. the viewer can edit. */
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setMenuOpen(false);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(action);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else setError(null);
    });
  }

  const unavailable = product.availabilityStatus !== "AVAILABLE";

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-panel transition-[border-color,box-shadow] duration-[120ms]",
        selected ? "border-primary ring-[3px] ring-primary/20" : "border-border hover:border-border-strong",
      )}
    >
      <div className="relative flex h-28 shrink-0 items-center justify-center bg-ramp-4">
        {product.image ? (
          <Image src={product.image} alt="" fill sizes="240px" className="object-cover" />
        ) : (
          <span className="font-money text-[34px] text-muted-foreground/70">{product.name.charAt(0)}</span>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <AvailabilityBadge status={product.availabilityStatus} isActive={product.isActive} />
          {product.status === "DRAFT" && <span className="inline-flex items-center rounded-full bg-flag-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-flag">Draft</span>}
        </div>
        {onToggleSelect && (
          <label className="absolute right-2 top-2 flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-panel/95 shadow-sm">
            <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select ${product.name}`} className="size-4 accent-primary" />
          </label>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-3.5 pt-3 pb-2.5">
        <Link href={`/app/iq/menu/products/${product.id}`} className="text-[14px] font-semibold leading-snug hover:underline">
          {product.name}
        </Link>
        {showCategoryName && <p className="text-[12.5px] text-muted-foreground">{product.categoryName ?? "Uncategorised"}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
          <span className="tabular text-[14px] font-semibold">{formatINR(product.basePrice)}</span>
          <div className="flex flex-wrap justify-end gap-1">
            {product.badges.slice(0, 2).map((badge) => (
              <span key={badge} className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-foreground/75">
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-col items-start gap-1.5 px-3.5 pb-2 text-[12.5px] text-loss">
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton className="min-h-[32px] px-3 text-xs" />}
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-border p-2">
        {unavailable ? (
          <button
            type="button"
            onClick={() => run(() => quickMarkAvailableAction(product.id))}
            disabled={isPending}
            className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-gain-soft px-2 text-[12.5px] font-semibold text-gain transition-colors duration-[120ms] hover:bg-gain-soft/70 disabled:opacity-60"
          >
            Make available
          </button>
        ) : (
          <QuickAvailabilityDialog
            productId={product.id}
            productName={product.name}
            trigger={
              <button type="button" className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-loss-soft px-2 text-[12.5px] font-semibold text-loss transition-colors duration-[120ms] hover:bg-loss-soft/70">
                Mark sold out
              </button>
            }
          />
        )}

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More actions"
            aria-expanded={menuOpen}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </button>

          {menuOpen && (
            <>
              {/* Click-outside catcher */}
              <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-20 w-52 rounded-lg border border-border bg-panel py-1 shadow-lg">
                {product.status === "DRAFT" && canPublish && (
                  <button type="button" onClick={() => run(() => publishProductAction(product.id))} disabled={isPending} className={cn(MENU_ITEM, "font-semibold")}>
                    Publish
                  </button>
                )}
                <button type="button" onClick={() => run(() => duplicateProductAction(product.id))} disabled={isPending} className={MENU_ITEM}>
                  Duplicate
                </button>
                <button type="button" onClick={() => run(() => moveProductPositionAction(product.id, "up"))} disabled={isPending} className={MENU_ITEM}>
                  Move up
                </button>
                <button type="button" onClick={() => run(() => moveProductPositionAction(product.id, "down"))} disabled={isPending} className={MENU_ITEM}>
                  Move down
                </button>
                {categories.length > 0 && (
                  <label className="flex flex-col gap-1 px-3 py-2 text-[13px]">
                    Move to category
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        run(() => moveProductToCategoryAction(product.id, e.target.value === "__none__" ? null : e.target.value));
                      }}
                      className="h-8 rounded-md border border-border bg-panel px-2 text-[13px]"
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      <option value="__none__">Uncategorised</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" onClick={() => run(() => setProductActiveAction(product.id, !product.isActive))} disabled={isPending} className={cn(MENU_ITEM, product.isActive && "text-loss")}>
                  {product.isActive ? "Archive" : "Restore"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
