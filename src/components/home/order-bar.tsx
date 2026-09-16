import { getPricedCart } from "@/lib/cart";
import { HomeOrderBarScroll } from "./order-bar-scroll";

/**
 * Adapted from frybird-web's src/components/site/order-bar.tsx. Same
 * phone-only slide-up behaviour and nudge (in HomeOrderBarScroll, the
 * client half); the Order link is cart-aware, matching the site's existing
 * OrderNowBar — real items go to /cart, an empty cart goes to /menu, both
 * read from the server's own cart, never the client's guess.
 */
export async function HomeOrderBar() {
  const cart = await getPricedCart();
  return <HomeOrderBarScroll hasItems={cart.itemCount > 0} itemCount={cart.itemCount} />;
}
