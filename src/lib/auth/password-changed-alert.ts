import "server-only";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";

interface PasswordChangedEvent {
  readonly orgId: string;
  readonly userId: string;
  readonly email: string | null;
  /** auth-v3, item C: which kind of account this is — decides the audit action name and whether the owner alert fires at all. */
  readonly kind: "staff" | "customer";
}

/**
 * Records a password change, for staff/owner AND customer accounts alike
 * (auth-v3, item C — the reset flow itself is now shared between them; see
 * `src/lib/auth/actions.ts`'s doc comment). Two independent, best-effort
 * steps, in this order:
 *
 * 1. The audit row — written unconditionally for EVERY account, staff or
 *    customer. This is the durable record, and it must exist whether or not
 *    `ALERT_URL` is ever configured; a push notification is a convenience
 *    on top of it, never a substitute. `kind` picks the action name
 *    (`password_changed` for staff/owner, `customer_password_changed` for a
 *    customer) so the two are never confused when read back later.
 * 2. The owner alert — ONLY for `kind: "staff"`. A staff/owner password
 *    change is the security-relevant event this alert exists for; a
 *    customer resetting their own account's password on the public site is
 *    routine and would just be noise (or, at volume, a reason to ignore the
 *    channel entirely) — it is still fully audited, just not pushed.
 *
 * Neither step can throw back into the caller: this always runs AFTER
 * `updateUser({ password })` has already succeeded, so a failure here — a
 * DB hiccup, ALERT_URL unreachable — must never look like the password
 * reset itself failed, and must never undo or retry the reset. Same
 * "never fails silently, never blocks the thing it's reacting to" posture
 * as this app's other owner-alert paths.
 */
export async function recordPasswordChangedAndAlert(event: PasswordChangedEvent): Promise<void> {
  const at = new Date().toISOString();

  try {
    await db()
      .insert(auditLogs)
      .values({
        orgId: event.orgId,
        actorUserId: event.userId,
        action: event.kind === "staff" ? "password_changed" : "customer_password_changed",
        entity: "auth_users",
        entityId: event.userId,
        after: { email: event.email, at },
      });
  } catch (err) {
    console.error("password-changed-alert: failed to write the audit row", err);
  }

  if (event.kind !== "staff") return;

  const message = `A staff/owner password was changed.\nAccount: ${event.email ?? event.userId}\nAt: ${at}`;
  const alertUrl = process.env.ALERT_URL;

  if (!alertUrl) {
    console.error(`ALERT [password_changed]: ${message}`);
    return;
  }

  try {
    await fetch(alertUrl, {
      method: "POST",
      headers: { Title: "Password changed", Priority: "default", Tags: "key" },
      body: message,
    });
  } catch (err) {
    console.error("password-changed-alert: failed to POST to ALERT_URL", err);
  }
}
