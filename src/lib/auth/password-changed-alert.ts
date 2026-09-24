import "server-only";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";

interface PasswordChangedEvent {
  readonly orgId: string;
  readonly userId: string;
  readonly email: string | null;
}

/**
 * Records a staff/owner password change and alerts the owners (auth-v2,
 * item B.1 / item 3). Two independent, best-effort steps, in this order:
 *
 * 1. The audit row — written unconditionally. This is the durable record,
 *    and it must exist whether or not `ALERT_URL` is ever configured; a
 *    push notification is a convenience on top of it, never a substitute.
 * 2. The alert itself — POSTs to `ALERT_URL` if set; if it's unset (or the
 *    POST fails), falls back to a loud `console.error` line so the event is
 *    still visible in the journal, never silently dropped.
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
        action: "password_changed",
        entity: "auth_users",
        entityId: event.userId,
        after: { email: event.email, at },
      });
  } catch (err) {
    console.error("password-changed-alert: failed to write the audit row", err);
  }

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
