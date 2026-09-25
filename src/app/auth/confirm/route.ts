import { NextResponse } from "next/server";

/**
 * Where an OLD confirmation or magic-link email lands.
 *
 * Customer auth is code-only now (auth-v2) — nothing in this app issues a
 * link pointing here any more, for signup confirmation or for sign-in. But
 * real emails sent before this change are still sitting in real inboxes,
 * and clicking one must never 404: this route stays, permanently, as a
 * plain redirect to the sign-in page with a short explanation, never
 * attempting to exchange the code. (It used to run `exchangeCodeForSession`
 * — deliberately removed, not because it stopped working, but because there
 * is no reason left to consume an old code at all now that a link can never
 * complete anything a customer needs; redirecting is simpler and equally
 * correct whether the code in the query string is still technically valid
 * or long expired.)
 *
 * A relative `Location` header, not `NextResponse.redirect(new URL(path,
 * request.url))` — see `/api/auth/sign-out/route.ts`'s comment.
 * `request.url` cannot be trusted to resolve to the real domain on this
 * deployment.
 */
export async function GET() {
  return new NextResponse(null, { status: 307, headers: { Location: "/account/sign-in?notice=links-retired" } });
}
