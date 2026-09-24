import "server-only";

import { headers } from "next/headers";

/**
 * The caller's IP, for rate limiting only — never logged, never stored.
 * `x-real-ip` is set by nginx on every request that reaches this app
 * (`deploy/nginx-frybird.conf`'s server-level `proxy_set_header`, inherited
 * by every location including the customer site); trusted the same way
 * `src/lib/jobs/auth.ts` trusts it, because nginx is the only path in. Null
 * only in a shell with no proxy in front (local dev), where IP-scoped
 * limiting is simply skipped and the email-scoped limit still applies.
 */
export async function clientIp(): Promise<string | null> {
  const list = await headers();
  return list.get("x-real-ip");
}
