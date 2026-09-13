"use server";

/**
 * Bill & Receipt — the designer's writes. `settings.manage` (OWNER) on
 * every one, re-checked here regardless of the page. Saving a draft never
 * changes what the POS prints; applying does, and is audited with the
 * design it replaced kept for restore.
 */

import { revalidatePath } from "next/cache";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { uploadMedia } from "@/lib/repositories/media";
import { applyReceiptDraft, restorePreviousReceiptDesign, saveReceiptDraft } from "@/lib/repositories/receipt";
import { parseTemplate } from "./template";

export type ReceiptActionResult = { ok: true } | { ok: false; error: string };

async function authorise(): Promise<{ orgId: string; userId: string } | { error: string }> {
  try {
    const staff = await requirePermission("settings.manage");
    return { orgId: staff.orgId, userId: staff.userId };
  } catch (error) {
    if (error instanceof NotSignedIn) return { error: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { error: "Only an owner can change the receipt design." };
    throw error;
  }
}

export async function saveReceiptDraftAction(raw: unknown): Promise<ReceiptActionResult> {
  const parsed = parseTemplate(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };
  await saveReceiptDraft(auth.orgId, auth.userId, parsed.template);
  revalidatePath("/app/admin/receipt");
  return { ok: true };
}

/** Saves the draft, then makes it the POS's receipt. */
export async function applyReceiptDesignAction(raw: unknown): Promise<ReceiptActionResult> {
  const parsed = parseTemplate(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };
  await saveReceiptDraft(auth.orgId, auth.userId, parsed.template);
  const result = await applyReceiptDraft(auth.orgId, auth.userId);
  if (result.ok) {
    revalidatePath("/app/admin/receipt");
    revalidatePath("/app/pos");
  }
  return result;
}

export async function restoreReceiptDesignAction(): Promise<ReceiptActionResult> {
  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await restorePreviousReceiptDesign(auth.orgId, auth.userId);
  if (result.ok) {
    revalidatePath("/app/admin/receipt");
    revalidatePath("/app/pos");
  }
  return result;
}

export type ReceiptUploadResult = { ok: true; url: string } | { ok: false; error: string };

/** A logo or a QR image for the bill — the same media library the menu uses. */
export async function uploadReceiptImageAction(formData: FormData): Promise<ReceiptUploadResult> {
  const auth = await authorise();
  if ("error" in auth) return { ok: false, error: auth.error };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose an image to upload." };
  const purpose = String(formData.get("purpose") ?? "receipt");
  const result = await uploadMedia({ orgId: auth.orgId, uploadedBy: auth.userId, file, alt: purpose === "logo" ? "Receipt logo" : purpose === "paymentQr" ? "Payment QR" : "Receipt QR" });
  return result.ok ? { ok: true, url: result.url } : result;
}
