import "server-only";

/**
 * The media library — upload once, reuse everywhere.
 *
 * Bytes live in Supabase Storage, in a bucket named `media`; this table is
 * the catalogue every picker (product photo, category banner) reads from
 * and writes into, so the same photo is never uploaded twice under two
 * different URLs. `createAdminClient` is used because uploads happen from a
 * staff-only Server Action already gated by `menu.edit`, not from a request
 * a customer controls — see `src/lib/supabase/server.ts`'s own warning about
 * when bypassing row-level security is justified.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, media, products } from "@/db/schema";
import { createAdminClient } from "@/lib/supabase/server";

export const MEDIA_BUCKET = "media";

export interface MediaRow {
  readonly id: string;
  readonly url: string;
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly createdAt: Date;
}

export async function listMedia(orgId: string): Promise<MediaRow[]> {
  return db().select({ id: media.id, url: media.url, alt: media.alt, width: media.width, height: media.height, createdAt: media.createdAt }).from(media).where(eq(media.orgId, orgId)).orderBy(desc(media.createdAt));
}

export interface MediaUsage {
  readonly productId: string;
  readonly productName: string;
  readonly categoryName: string | null;
}

export interface MediaUsageRow extends MediaRow {
  /** Every product (archived ones included — they still reference the file) currently carrying this photo. Empty means orphaned. */
  readonly usedBy: readonly MediaUsage[];
}

/**
 * The library plus, for each photo, which products currently carry it.
 *
 * Derived at read time from `products.images` — jsonb, not a foreign key —
 * with the same predicate `deleteMedia` uses to refuse a delete, so "is
 * this photo in use" has exactly one definition. Powers the library's
 * search-by-product/category and shows which uploads nothing uses.
 */
export async function listMediaWithUsage(orgId: string): Promise<MediaUsageRow[]> {
  const database = db();
  const [rows, usage] = await Promise.all([
    listMedia(orgId),
    database
      .select({ mediaId: media.id, productId: products.id, productName: products.name, categoryName: categories.name })
      .from(media)
      .innerJoin(
        products,
        and(eq(products.orgId, media.orgId), sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${products.images}) AS elem WHERE elem->>'url' = ${media.url})`),
      )
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(media.orgId, orgId))
      .orderBy(asc(products.name)),
  ]);

  const byMedia = new Map<string, MediaUsage[]>();
  for (const use of usage) {
    const list = byMedia.get(use.mediaId) ?? [];
    list.push({ productId: use.productId, productName: use.productName, categoryName: use.categoryName });
    byMedia.set(use.mediaId, list);
  }

  return rows.map((row) => ({ ...row, usedBy: byMedia.get(row.id) ?? [] }));
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function uploadMedia(input: {
  orgId: string;
  uploadedBy: string;
  file: File;
  alt: string;
}): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
  if (!ALLOWED_TYPES.has(input.file.type)) return { ok: false, error: "Only JPEG, PNG or WebP images are accepted." };
  if (input.file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "That image is larger than 8 MB." };

  const supabase = createAdminClient();
  const extension = input.file.type === "image/png" ? "png" : input.file.type === "image/webp" ? "webp" : "jpg";
  const path = `${input.orgId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, input.file, {
    contentType: input.file.type,
    cacheControl: "31536000",
  });
  if (uploadError) return { ok: false, error: "Upload failed. Try again." };

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);

  const [row] = await db()
    .insert(media)
    .values({ orgId: input.orgId, url: data.publicUrl, alt: input.alt, uploadedBy: input.uploadedBy })
    .returning({ id: media.id });
  if (!row) return { ok: false, error: "Could not save the upload." };

  return { ok: true, id: row.id, url: data.publicUrl };
}

/**
 * Deletes a media row and its underlying Storage object.
 *
 * Refused while any product in this organization still carries this photo's
 * URL in its `images` — that column is jsonb rather than a foreign key, so
 * nothing enforces this at the database level the way `deleteCategory`'s
 * guard is backed by a real FK; the check happens here, inside the one
 * function that can actually delete the file, rather than trusted to
 * whichever caller remembers to check first.
 *
 * Wired to `deleteMediaAction` from the media library, which also shows
 * each photo's usage (`listMediaWithUsage`) and disables delete on the ones
 * still in use — so this refusal is the backstop, not how anyone finds out.
 */
export async function deleteMedia(orgId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const database = db();
  const [row] = await database.select({ url: media.url }).from(media).where(and(eq(media.id, id), eq(media.orgId, orgId))).limit(1);
  if (!row) return { ok: false, error: "Not found." };

  const [inUse] = await database
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.orgId, orgId),
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${products.images}) AS elem WHERE elem->>'url' = ${row.url})`,
      ),
    )
    .limit(1);
  if (inUse) return { ok: false, error: "This photo is still used by a product. Remove it there first." };

  const supabase = createAdminClient();
  const path = row.url.split(`/${MEDIA_BUCKET}/`)[1];
  if (path) await supabase.storage.from(MEDIA_BUCKET).remove([path]);

  await database.delete(media).where(eq(media.id, id));
  return { ok: true };
}
