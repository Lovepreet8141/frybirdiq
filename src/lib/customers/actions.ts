"use server";

/**
 * Edit a customer (roadmap 7.1). `customers.edit` is re-checked here
 * regardless of which page rendered the form (§41); the org comes from the
 * signed-in staff member, never from the form.
 */

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { updateCustomer } from "@/lib/repositories/customers";
import { parseCustomerEdit } from "./edit";

export type CustomerEditState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message: string; savedAt: number };

export async function updateCustomerAction(_previous: CustomerEditState, formData: FormData): Promise<CustomerEditState> {
  let staff;
  try {
    staff = await requirePermission("customers.edit");
  } catch {
    return { status: "error", message: "You don't have permission to edit customers." };
  }

  const field = (name: string) => String(formData.get(name) ?? "");
  const customerId = field("customerId");
  const parsed = parseCustomerEdit({ name: field("name"), phone: field("phone"), email: field("email"), notes: field("notes"), key: field("key") });
  if (!parsed.ok) return { status: "error", message: parsed.error };

  const { key, ...values } = parsed.value;
  let result;
  try {
    result = await updateCustomer({ orgId: staff.orgId, actorUserId: staff.userId, customerId, key, ...values });
  } catch {
    return { status: "error", message: "Couldn't save. Check the connection and try again." };
  }
  if (!result.ok) {
    return {
      status: "error",
      message: result.reason === "phone_taken" ? "Another customer already has that number." : "This customer no longer exists.",
    };
  }
  revalidatePath(`/app/customers/${customerId}`);
  revalidatePath("/app/customers");
  return { status: "success", message: "Saved.", savedAt: Date.now() };
}
