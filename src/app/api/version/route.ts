import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/version: which build is running, for staff screens left open across
 * a deploy. Public and unauthenticated like /api/health, and it reveals only an
 * opaque hash of the build (not the commit). `NEXT_PUBLIC_BUILD_ID` is
 * inlined at build time, the same value the browser bundle carries, so an old
 * bundle and a new server disagree exactly when a deploy happened. No org data.
 */
export function GET() {
  return NextResponse.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
