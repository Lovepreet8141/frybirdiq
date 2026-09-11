"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { setProductImagesAction, uploadMediaAction } from "@/lib/menu-admin/actions";
import { ReloadAppButton } from "@/components/reload-app-button";
import { STALE_DEPLOYMENT_MESSAGE, recoverFromStaleDeployment } from "@/lib/errors/stale-deployment";

interface Img {
  readonly url: string;
  readonly alt: string;
}

export function ProductMediaForm({
  productId,
  initialImages,
  library,
}: {
  productId: string;
  initialImages: readonly Img[];
  library: readonly { id: string; url: string; alt: string }[];
}) {
  const [images, setImages] = useState<Img[]>([...initialImages]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function persist(next: Img[]) {
    setImages(next);
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => setProductImagesAction(productId, next));
      if (!result.ok) setError(result.error ?? "Could not save.");
      else setError(null);
    });
  }

  function addFromLibrary(item: { url: string; alt: string }) {
    if (images.some((img) => img.url === item.url)) return;
    persist([...images, item]);
  }

  function remove(url: string) {
    persist(images.filter((img) => img.url !== url));
  }

  function upload(formData: FormData) {
    startTransition(async () => {
      const result = await recoverFromStaleDeployment(() => uploadMediaAction(formData));
      if (!result.ok) {
        setError(result.error ?? "Upload failed.");
        return;
      }
      setError(null);
      persist([...images, { url: result.url, alt: String(formData.get("alt") ?? "") }]);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div role="alert" className="flex flex-col items-start gap-1.5 text-sm text-[var(--destructive)]">
          {error}
          {error === STALE_DEPLOYMENT_MESSAGE && <ReloadAppButton />}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          This product&apos;s photos <span className="font-normal normal-case">(first is the main photo)</span>
        </p>
        {images.length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {images.map((img) => (
              <li key={img.url} className="relative size-20 overflow-hidden rounded-md border border-border">
                <Image src={img.url} alt={img.alt} fill sizes="80px" className="object-cover" />
                <button
                  type="button"
                  onClick={() => remove(img.url)}
                  disabled={isPending}
                  aria-label="Remove photo"
                  className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-[var(--destructive)] text-xs font-bold text-white"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        action={upload}
        className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
      >
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Upload a new photo
          <input ref={fileRef} type="file" name="file" accept="image/jpeg,image/png,image/webp" required className="text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Alt text
          <input name="alt" placeholder="Describes the photo" className="min-h-[36px] rounded-md border border-border bg-surface px-3 font-normal" />
        </label>
        <button type="submit" disabled={isPending} className="inline-flex min-h-[36px] items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {isPending ? "Working…" : "Upload"}
        </button>
      </form>

      {library.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Or pick from the media library</p>
          <ul className="flex flex-wrap gap-2">
            {library.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => addFromLibrary(item)}
                  disabled={isPending}
                  className="relative block size-16 overflow-hidden rounded-md border border-border hover:border-primary"
                >
                  <Image src={item.url} alt={item.alt} fill sizes="64px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
