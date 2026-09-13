"use server";

/**
 * Operations settings — kitchen capacity and the opening date.
 *
 * A settings change, not a deploy: the Overview reads both on the next
 * request. `settings.manage` is OWNER-only and re-checked here regardless
 * of the page that rendered the form (§41).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { updateOperationsSettings } from "@/lib/repositories/settings";

export type OperationsSettingsState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message: string };

const schema = z.object({
  kitchenCapacity: z.coerce.number().int().min(1, "The kitchen can carry at least 1 ticket.").max(200, "200 open tickets is beyond any single kitchen."),
  openedOn: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the opening date as a calendar date.").nullable()),
});

export async function updateOperationsSettingsAction(_previous: OperationsSettingsState, formData: FormData): Promise<OperationsSettingsState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: "You don't have permission to change restaurant settings." };
  }

  const parsed = schema.safeParse({
    kitchenCapacity: String(formData.get("kitchenCapacity") ?? ""),
    openedOn: String(formData.get("openedOn") ?? ""),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  if (parsed.data.openedOn && Date.parse(`${parsed.data.openedOn}T00:00:00Z`) > Date.now()) {
    return { status: "error", message: "The opening date can't be in the future." };
  }

  await updateOperationsSettings(staff.orgId, parsed.data);
  revalidatePath("/app/admin/restaurant");
  revalidatePath("/app/iq");
  return { status: "success", message: "Saved. The Overview reads these from the next load." };
}
