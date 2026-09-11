"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { deleteMediaAction, uploadMediaAction } from "@/lib/menu-admin/actions";
import type { MediaRow } from "@/lib/repositories/media";

/**
 * The standalone media library — upload, search, and delete (refused by the
 * server while a product still uses the photo; see `deleteMedia`). Product
 * photo pickers (`ProductMediaForm`) read from the same `media` table, so a
 * photo uploaded here shows up there immediately, and vice versa — one
 * catalogue, not two.
 */
export function MediaLibrary({ initialItems }: { initialItems: readonly MediaRow[] }) {
  const [items, setItems] = useState<readonly MediaRow[]>(initialItems);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const normalised = search.trim().toLowerCase();
  const filtered = normalised ? items.filter((item) => item.alt.toLowerCase().includes(normalised)) : items;

  function upload(formData: FormData) {
    startTransition(async () => {
      const result = await uploadMediaAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Upload failed.");
        return;
      }
      setError(null);
      setItems((current) => [{ id: result.id, url: result.url, alt: String(formData.get("alt") ?? ""), width: null, height: null, createdAt: new Date() }, ...current]);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function remove(id: string) {
    if (!window.confirm("Delete this photo? This can't be undone.")) return;
    startTransition(async () => {
      const result = await deleteMediaAction(id);
      if (!result.ok) {
        setError(result.error ?? "Could not delete.");
        return;
      }
      setError(null);
      setItems((current) => current.filter((item) => item.id !== id));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={upload} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Upload a photo
          <input ref={fileRef} type="file" name="file" accept="image/jpeg,image/png,image/webp" required className="text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Alt text
          <input name="alt" placeholder="Describes the photo" className="min-h-[36px] rounded-md border border-border bg-background px-3 font-normal" />
        </label>
        <button type="submit" disabled={isPending} className="inline-flex min-h-[36px] items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {isPending ? "Working…" : "Upload"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {error}
        </p>
      )}

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by alt text"
        className="h-[40px] max-w-sm rounded-md border border-border bg-surface px-3 text-sm"
      />

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{items.length === 0 ? "No photos uploaded yet." : "Nothing matches that search."}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {filtered.map((item) => (
            <div key={item.id} className="group relative aspect-square overflow-hidden rounded-md border border-border">
              <Image src={item.url} alt={item.alt} fill sizes="180px" className="object-cover" />
              <button
                type="button"
                onClick={() => remove(item.id)}
                disabled={isPending}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`Delete ${item.alt || "photo"}`}
              >
                ×
              </button>
              {item.alt && <p className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{item.alt}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
