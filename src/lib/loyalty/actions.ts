"use server";

/**
 * FRYBIRD IQ's rewards settings — the only place these rules change.
 *
 * A settings change, not a deploy: the numbers this writes are read by
 * every order the moment it is priced, through `getStampConfig`. §41 —
 * `settings.manage` is OWNER-only, and re-checked here regardless of
 * whether the page that renders the form already checked it.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { fromRupees } from "@/lib/money";
import { updateStampConfig } from "./config";

export type RewardsSettingsState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

const settingsSchema = z.object({
  enabled: z.coerce.boolean(),
  stampsRequired: z.coerce.number().int().min(1, "Needs at least 1 stamp.").max(50, "50 stamps is already a lot to ask."),
  minOrderValue: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 200 or 200.50."),
  maxRewardValue: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 250 or 250.50."),
});

export async function updateStampConfigAction(
  _previous: RewardsSettingsState,
  formData: FormData,
): Promise<RewardsSettingsState> {
  let staff;
  try {
    staff = await requirePermission("settings.manage");
  } catch {
    return { status: "error", message: "You don't have permission to change FRYBIRD REWARDS." };
  }

  const parsed = settingsSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    stampsRequired: String(formData.get("stampsRequired") ?? ""),
    minOrderValue: String(formData.get("minOrderValue") ?? ""),
    maxRewardValue: String(formData.get("maxRewardValue") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const minOrderValue = fromRupees(parsed.data.minOrderValue);
  const maxRewardValue = fromRupees(parsed.data.maxRewardValue);

  if (maxRewardValue <= 0n) {
    return { status: "error", message: "The free-item cap has to be worth something." };
  }

  await updateStampConfig(staff.orgId, {
    enabled: parsed.data.enabled,
    stampsRequired: parsed.data.stampsRequired,
    minOrderValue,
    maxRewardValue,
  });

  revalidatePath("/app/iq/rewards");
  revalidatePath("/", "layout");
  return { status: "success", message: "Saved." };
}
