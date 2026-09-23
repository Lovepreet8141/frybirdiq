import "server-only";

/**
 * Tells a human when an OWNER-level membership is created or reactivated
 * (card `alert-owner-created`). Every other role change already writes an
 * audit row nobody has to go looking for; this one role can grant every
 * other role, so its arrival gets a push, not just a row.
 *
 * `src/lib/repositories/staff.ts` writes the audit row itself, inside the
 * same transaction as the membership write, so the record is never lost to
 * a failed alert. This module only sends the loud part, and never throws —
 * a delivery failure must not turn an OWNER invite an ADMIN is allowed to
 * make into a 500.
 */

import { serverEnv } from "@/lib/env";

export type OwnerMembershipEvent = "created" | "reactivated";

function alertMessage(event: OwnerMembershipEvent, orgId: string, userId: string, when: string): string {
  return `FRYBIRD ALERT: OWNER membership ${event} — org ${orgId}, user ${userId}, at ${when}`;
}

/**
 * Sends to `ALERT_URL` once the owner has set one; until then, and on any
 * delivery failure, writes the same line to the journal (`console.error`,
 * same convention as `remembered-contact.ts`'s missing-secret alert). The
 * URL itself is a credential (`deploy/notify.sh`'s comment on `ALERT_URL`
 * applies here too) and is never included in a log line.
 */
export async function sendOwnerMembershipAlert(event: OwnerMembershipEvent, orgId: string, userId: string): Promise<void> {
  const when = new Date().toISOString();
  const message = alertMessage(event, orgId, userId, when);
  const url = serverEnv().ALERT_URL;

  if (!url) {
    console.error(message);
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Title: `FRYBIRD OWNER membership ${event}`,
        Priority: "high",
        Tags: "rotating_light",
      },
      body: message,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`${message} (ALERT_URL delivery failed: HTTP ${response.status})`);
    }
  } catch (error) {
    console.error(`${message} (ALERT_URL delivery failed: ${error instanceof Error ? error.message : "unknown error"})`);
  }
}
