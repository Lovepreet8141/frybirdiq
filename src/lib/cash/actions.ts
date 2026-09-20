"use server";

/**
 * The till (roadmap 5.1-5.2): open it, close it, take a rider's door cash into
 * it. `finance.manage`, re-checked here regardless of the page that rendered the
 * form (§41); the org and the person are the signed-in staff member's own, never
 * from the request. Amounts arrive as text and are parsed by the money rules.
 * Every change is audited in the repository, against this person.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotPermitted, NotSignedIn, requirePermission } from "@/lib/auth";
import { CASH_NOTE_MAX } from "@/db/schema";
import { parseCashAmount, varianceWords } from "@/lib/cash/session";
import { closeCashSession, openCashSession, recordCashHandover } from "@/lib/repositories/cash-sessions";
import { formatINR } from "@/lib/money";

export type CashFormState = { readonly status: "idle" } | { readonly status: "error"; readonly message: string } | { readonly status: "success"; readonly message: string };

const noteSchema = z
  .string()
  .trim()
  .max(CASH_NOTE_MAX, `Keep the note under ${CASH_NOTE_MAX} characters.`)
  .transform((value) => (value === "" ? null : value));

async function authorise(): Promise<{ readonly orgId: string; readonly userId: string } | CashFormState> {
  try {
    const staff = await requirePermission("finance.manage");
    return { orgId: staff.orgId, userId: staff.userId };
  } catch (error) {
    if (error instanceof NotSignedIn) return { status: "error", message: "You've been signed out. Sign in again." };
    if (error instanceof NotPermitted) return { status: "error", message: "You don't have permission to run the till." };
    throw error;
  }
}

const isFailure = (value: { orgId: string; userId: string } | CashFormState): value is CashFormState => "status" in value;

function refresh() {
  revalidatePath("/app/finance");
}

export async function openCashSessionAction(_previous: CashFormState, formData: FormData): Promise<CashFormState> {
  const who = await authorise();
  if (isFailure(who)) return who;
  const float = parseCashAmount(String(formData.get("openingFloat") ?? ""), "the float");
  if (!float.ok) return { status: "error", message: float.error };
  const note = noteSchema.safeParse(String(formData.get("note") ?? ""));
  if (!note.success) return { status: "error", message: note.error.issues[0]?.message ?? "Check the note." };

  const result = await openCashSession({ orgId: who.orgId, actorUserId: who.userId, openingFloat: float.value, note: note.data });
  if (!result.ok) return { status: "error", message: result.error };
  refresh();
  return { status: "success", message: `Till opened with a float of ${formatINR(float.value)}.` };
}

export async function closeCashSessionAction(_previous: CashFormState, formData: FormData): Promise<CashFormState> {
  const who = await authorise();
  if (isFailure(who)) return who;
  const sessionId = z.uuid().safeParse(String(formData.get("sessionId") ?? ""));
  if (!sessionId.success) return { status: "error", message: "That till could not be found. Reload and try again." };
  const counted = parseCashAmount(String(formData.get("countedCash") ?? ""), "the counted cash");
  if (!counted.ok) return { status: "error", message: counted.error };
  const note = noteSchema.safeParse(String(formData.get("note") ?? ""));
  if (!note.success) return { status: "error", message: note.error.issues[0]?.message ?? "Check the note." };

  const result = await closeCashSession({ orgId: who.orgId, actorUserId: who.userId, sessionId: sessionId.data, counted: counted.value, note: note.data });
  if (!result.ok) return { status: "error", message: result.error };
  refresh();
  // The expected figure is shown only now: the count above was made without seeing it.
  return { status: "success", message: `Till closed. Counted ${formatINR(result.counted)}, expected ${formatINR(result.expected)}: ${varianceWords(result.variance)}.` };
}

export async function recordCashHandoverAction(_previous: CashFormState, formData: FormData): Promise<CashFormState> {
  const who = await authorise();
  if (isFailure(who)) return who;
  const riderUserId = z.uuid().safeParse(String(formData.get("riderUserId") ?? ""));
  if (!riderUserId.success) return { status: "error", message: "Choose a rider." };
  const declared = parseCashAmount(String(formData.get("declaredCash") ?? ""), "the cash handed over");
  if (!declared.ok) return { status: "error", message: declared.error };
  const note = noteSchema.safeParse(String(formData.get("note") ?? ""));
  if (!note.success) return { status: "error", message: note.error.issues[0]?.message ?? "Check the note." };

  const result = await recordCashHandover({ orgId: who.orgId, actorUserId: who.userId, riderUserId: riderUserId.data, declared: declared.value, note: note.data });
  if (!result.ok) return { status: "error", message: result.error };
  refresh();
  return {
    status: "success",
    message: `Rider cash received: ${result.paymentCount} ${result.paymentCount === 1 ? "payment" : "payments"}, ${formatINR(result.expected)} owed, ${formatINR(result.declared)} handed over: ${varianceWords(result.variance)}.`,
  };
}
