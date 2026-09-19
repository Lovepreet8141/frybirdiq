import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createHealthCheck } from "@/lib/health/check";

export const dynamic = "force-dynamic";

// Known limit: when the database HANGS (rather than refuses), the 3 s timeout
// reports "unavailable" but does not cancel the query, so each expired probe
// keeps its pool connection until the database answers or the socket dies.
// Bounded to about one probe per cache window (~5 s) and the app is already
// down in that state, so it is left unfixed on purpose.
const check = createHealthCheck({ probe: () => db().execute(sql`select 1`) });

/**
 * GET /api/health — for an external uptime monitor and the on-box checks.
 * 200 {"status":"ok"} only when the app answered AND the database did;
 * 503 {"status":"unavailable"} otherwise. Public, no auth, and it reveals
 * nothing else (no version, commit, schema or error text). The answer is
 * cached for a few seconds in src/lib/health so the URL cannot be used to
 * hammer the database. It reads no org data, so there is no org_id to scope.
 */
export async function GET() {
  const { ok, body } = await check();
  return NextResponse.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
