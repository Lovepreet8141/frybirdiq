"use server";

/**
 * Server Actions for dine-in table management. BUILD-PLAN.md §22.
 *
 * Every action re-checks its own permission, same convention as
 * `src/lib/menu-admin/actions.ts` — creating a table is a floor-plan change
 * (`settings.manage`), assigning or clearing one is an order mutation
 * (`orders.update`). Rendering the grid is never the check; the action is. §41.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { assignOrderToTable, clearTable, createTable } from "@/lib/repositories/tables";

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

function explain(error: unknown): ActionResult {
  if (error instanceof NotSignedIn) return { ok: false, error: "You've been signed out. Sign in again." };
  if (error instanceof NotPermitted) return { ok: false, error: "You don't have permission to do that." };
  if (error instanceof Error) return { ok: false, error: error.message };
  throw error;
}

const createTableSchema = z.object({
  name: z.string().trim().min(1, "Needs a name."),
  category: z.string().trim().max(60).optional(),
  capacity: z.coerce.number().int().positive().optional(),
});

export async function createTableAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = createTableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };

  try {
    const staff = await requirePermission("settings.manage");
    await createTable(staff.orgId, {
      name: parsed.data.name,
      category: parsed.data.category || null,
      capacity: parsed.data.capacity ?? null,
    });
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function assignOrderToTableAction(orderId: string, tableId: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("orders.update");
    await assignOrderToTable(staff.orgId, orderId, tableId);
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}

export async function clearTableAction(tableId: string): Promise<ActionResult> {
  try {
    const staff = await requirePermission("orders.update");
    await clearTable(staff.orgId, tableId);
    revalidatePath("/app/pos");
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
}
