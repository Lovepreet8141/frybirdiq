import "server-only";

/**
 * The Menu Control Center's one, shared cache-invalidation strategy.
 *
 * Every mutating Server Action in `actions.ts` calls this exactly once, at
 * the end, unconditionally — never `revalidatePath` directly, never a
 * bespoke subset. A menu mutation is not "done" when it persists to
 * Supabase; it is done when Website and POS can actually see it, and this
 * function is the one place that guarantee is kept.
 *
 * Closes a real gap the previous version had: `/item/[slug]` was never
 * revalidated by anything, so a name/price/photo/availability change could
 * persist correctly and still show stale on the one page a customer is most
 * likely looking at.
 *
 * Repository functions (`menu-admin.ts`) never call this themselves — that
 * separation is what makes a future bulk action cheap: loop the repository
 * call N times, call this once.
 */

import { revalidatePath } from "next/cache";
import { clearMenuCache } from "@/lib/repositories/menu-cache";

export function revalidateMenuSurfaces(input?: { productSlug?: string }): void {
  clearMenuCache(); // the 45 s public-menu copy, so an edit shows at once
  revalidatePath("/", "page"); // homepage signature/featured products
  revalidatePath("/menu", "page"); // full customer menu
  revalidatePath("/app/pos", "page"); // POS shell (belt-and-braces alongside its own polling)
  revalidatePath("/app/iq/menu", "layout"); // every admin menu subpage, one call, nothing missed
  if (input?.productSlug) revalidatePath(`/item/${input.productSlug}`, "page");
}
