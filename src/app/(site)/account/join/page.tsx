import { redirect } from "next/navigation";

/**
 * Sign-up and sign-in are one screen now (auth-v2) — `/account/sign-in`
 * handles both, deciding which by the email address, not by which page
 * sent it there. This route stays, permanently, as a redirect rather than
 * a 404: an old link to "Create an account" (a bookmark, a search result,
 * a stale email) must still land somewhere real.
 */
export default function JoinPage() {
  redirect("/account/sign-in");
}
