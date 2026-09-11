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
import { AvailabilityBadge } from "./availability-badge";
import { QuickAvailabilityDialog } from "./quick-availability-dialog";

export function ProductAdminCard({
  product,
  categories,
  canPublish,
  showCategoryName,
}: {
  product: ProductAdminRow;
  categories: readonly { id: string; name: string }[];
  canPublish: boolean;
  showCategoryName: boolean;
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
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="relative flex h-28 shrink-0 items-center justify-center bg-surface-muted">
        {product.image ? (
          <Image src={product.image} alt="" fill sizes="240px" className="object-cover" />
        ) : (
          <span className="font-heading text-3xl font-black text-muted-foreground">{product.name.charAt(0)}</span>
        )}
        <div className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          <AvailabilityBadge status={product.availabilityStatus} isActive={product.isActive} />
          {product.status === "DRAFT" && <span className="inline-flex items-center rounded-full bg-[var(--warning)]/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--warning)]">Draft</span>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link href={`/app/iq/menu/products/${product.id}`} className="font-semibold leading-snug hover:underline">
          {product.name}
        </Link>
        {showCategoryName && <p className="text-xs text-muted-foreground">{product.categoryName ?? "Uncategorised"}</p>}
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="tabular text-sm font-bold">{formatINR(product.basePrice)}</span>
          <div className="flex flex-wrap gap-1">
            {product.badges.slice(0, 2).map((badge) => (
              <span key={badge} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-col items-start gap-1.5 px-3 pb-2 text-xs text-[var(--destructive)]">
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
            className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-[var(--success)]/15 px-2 text-xs font-semibold text-[var(--success)] disabled:opacity-60"
          >
            Make available
          </button>
        ) : (
          <QuickAvailabilityDialog
            productId={product.id}
            productName={product.name}
            trigger={
              <button type="button" className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-[var(--destructive)]/10 px-2 text-xs font-semibold text-[var(--destructive)]">
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
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </button>

          {menuOpen && (
            <>
              {/* Click-outside catcher */}
              <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-20 w-52 rounded-md border border-border bg-surface py-1 shadow-lg">
                {product.status === "DRAFT" && canPublish && (
                  <button type="button" onClick={() => run(() => publishProductAction(product.id))} disabled={isPending} className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-muted">
                    Publish
                  </button>
                )}
                <button type="button" onClick={() => run(() => duplicateProductAction(product.id))} disabled={isPending} className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-muted">
                  Duplicate
                </button>
                <button type="button" onClick={() => run(() => moveProductPositionAction(product.id, "up"))} disabled={isPending} className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-muted">
                  Move up
                </button>
                <button type="button" onClick={() => run(() => moveProductPositionAction(product.id, "down"))} disabled={isPending} className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-muted">
                  Move down
                </button>
                {categories.length > 0 && (
                  <label className="flex flex-col gap-1 px-3 py-2 text-sm">
                    Move to category
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        run(() => moveProductToCategoryAction(product.id, e.target.value === "__none__" ? null : e.target.value));
                      }}
                      className="min-h-[32px] rounded-md border border-border bg-background px-2 text-sm"
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
                <button type="button" onClick={() => run(() => setProductActiveAction(product.id, !product.isActive))} disabled={isPending} className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-muted">
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
