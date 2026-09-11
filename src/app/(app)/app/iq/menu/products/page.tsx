import { redirect } from "next/navigation";

/**
 * The Menu Control Center (`/app/iq/menu`) is now the products view — search,
 * filters, category navigation and the product grid all live there. This
 * route survives only so an old bookmark or link still lands somewhere.
 */
export default function ProductsRedirectPage() {
  redirect("/app/iq/menu");
}
