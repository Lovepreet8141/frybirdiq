"use client";

import { Loader2, X } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState, useTransition } from "react";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { ReloadAppButton } from "@/components/reload-app-button";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";
import { deleteMediaAction, uploadMediaAction } from "@/lib/menu-admin/actions";
import type { MediaUsageRow } from "@/lib/repositories/media";
import { cn } from "@/lib/utils";

/**
 * The standalone media library — upload, search, and delete (refused by the
 * server while a product still uses the photo; see `deleteMedia`). Product
 * photo pickers (`ProductMediaForm`) read from the same `media` table, so a
 * photo uploaded here shows up there immediately, and vice versa — one
 * catalogue, not two.
 *
 * Search matches alt text and the names of the products and categories that
 * actually carry each photo (`listMediaWithUsage`), so "find the Zinger
 * photo" works whether or not anyone wrote alt text. "Unused only" is the
 * orphan finder — what was uploaded and never attached to anything.
 */
function matches(item: MediaUsageRow, needle: string): boolean {
  if (item.alt.toLowerCase().includes(needle)) return true;
  return item.usedBy.some((use) => use.productName.toLowerCase().includes(needle) || (use.categoryName ?? "").toLowerCase().includes(needle));
}

export function MediaLibrary({ initialItems }: { initialItems: readonly MediaUsageRow[] }) {
  const [items, setItems] = useState<readonly MediaUsageRow[]>(initialItems);
  const [search, setSearch] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const unusedId = useId();

  const normalised = search.trim().toLowerCase();
  const filtered = items.filter((item) => (!normalised || matches(item, normalised)) && (!unusedOnly || item.usedBy.length === 0));
  const unusedCount = items.filter((item) => item.usedBy.length === 0).length;

  function upload(formData: FormData) {
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => uploadMediaAction(formData));
      if (!result.ok) {
        setError(result.error ?? "Upload failed.");
        return;
      }
      setError(null);
      setItems((current) => [
        { id: result.id, url: result.url, alt: String(formData.get("alt") ?? ""), width: null, height: null, createdAt: new Date(), usedBy: [] },
        ...current,
      ]);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function remove(id: string) {
    if (!window.confirm("Delete this photo? This can't be undone.")) return;
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => deleteMediaAction(id));
      if (!result.ok) {
        setError(result.error ?? "Could not delete.");
        return;
      }
      setError(null);
      setItems((current) => current.filter((item) => item.id !== id));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <PanelHeader title="Upload a photo" description="JPEG, PNG or WebP up to 8 MB." />
        <PanelBody>
          <form action={upload} className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="media-file" className="text-[13px] font-semibold">
                Photo
              </Label>
              {/* Native input, not the `Input` primitive — it isn't a forwardRef component and this field needs a ref to reset after a successful upload. */}
              <input
                ref={fileRef}
                id="media-file"
                type="file"
                name="file"
                accept="image/jpeg,image/png,image/webp"
                required
                className="h-10 w-64 rounded-md border border-input bg-panel text-sm text-foreground outline-none file:mr-3 file:h-full file:border-0 file:border-r file:border-input file:bg-transparent file:px-3 file:text-sm file:font-medium file:text-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="media-alt" className="text-[13px] font-semibold">
                Alt text
              </Label>
              <Input id="media-alt" name="alt" placeholder="Describes the photo" className="w-56" />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {isPending ? "Working…" : "Upload"}
            </Button>
          </form>

          {error && (
            <p role="alert" className="mt-3 rounded-md border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-sm">
              {error}
              {error === STALE_DEPLOYMENT_MESSAGE && (
                <span className="mt-2 block">
                  <ReloadAppButton />
                </span>
              )}
            </p>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Library"
          description={`${items.length} ${items.length === 1 ? "photo" : "photos"}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={searchId} className="sr-only">
                Search photos
              </Label>
              <Input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by product, category or alt text" className="h-9 w-56" />
              <label htmlFor={unusedId} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-[13px]">
                <input id={unusedId} type="checkbox" checked={unusedOnly} onChange={(event) => setUnusedOnly(event.target.checked)} className="size-4 accent-primary" />
                Unused only <span className="tabular text-muted-foreground">({unusedCount})</span>
              </label>
            </div>
          }
        />
        <PanelBody>
          {items.length === 0 ? (
            <EmptyState title="No photos uploaded yet" detail="Upload one above — it becomes available to every product and category photo picker immediately." />
          ) : filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">{unusedOnly && !normalised ? "Every photo is in use." : "Nothing matches that search."}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {filtered.map((item) => {
                const inUse = item.usedBy.length > 0;
                return (
                  <div key={item.id} className="flex flex-col gap-1">
                    <div className="relative aspect-square overflow-hidden rounded-md border border-border">
                      <Image src={item.url} alt={item.alt} fill sizes="180px" className="object-cover" />
                      <button
                        type="button"
                        onClick={() => remove(item.id)}
                        disabled={isPending || inUse}
                        title={inUse ? "Remove it from its products first" : "Delete photo"}
                        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors duration-[120ms] hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Delete ${item.alt || "photo"}`}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                      {item.alt && <p className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{item.alt}</p>}
                    </div>
                    <p className={cn("truncate text-[11px]", inUse ? "text-muted-foreground" : "font-semibold text-flag")} title={inUse ? item.usedBy.map((use) => use.productName).join(", ") : undefined}>
                      {inUse ? item.usedBy.map((use) => use.productName).join(", ") : "Not used by any product"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
