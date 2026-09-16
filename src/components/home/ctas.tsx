/**
 * Adapted from frybird-web's src/components/site/ctas.tsx. The one real
 * change: frybird-web is a separate marketing site, so every "Order now"
 * was a link out to `https://frybirdiq.tech`. This *is* frybirdiq.tech now,
 * so every one of these becomes an internal link into the real ordering
 * flow — /menu, the same browse-then-add-to-cart entry point the rest of
 * the site already uses. No second cart, no second checkout.
 */

const ORDER_HREF = "/menu";

/** Nav CTA: a red stamp that physically imprints when pressed. */
export function OrderStamp({ className }: { className?: string }) {
  return (
    <a className={["fb-stamp", className].filter(Boolean).join(" ")} href={ORDER_HREF}>
      Order now
    </a>
  );
}

/** Hero CTAs: the two pills from the ordering site — order, or see the menu. */
export function OrderLine() {
  return (
    <div className="fb-hero-actions">
      <a className="fb-btn" href={ORDER_HREF}>
        Order now
      </a>
      <a className="fb-btn fb-btn--ghost" href="/menu">
        See the menu
      </a>
    </div>
  );
}

/** Menu CTA: a perforated ticket whose stub tears away on hover. */
export function OrderTicket() {
  return (
    <a className="fb-ticket" href={ORDER_HREF}>
      <span className="fb-ticket__main">
        <small>Pick-up or delivery</small>
        Order now
      </span>
      <span aria-hidden="true" className="fb-ticket__stub">
        &rarr;
      </span>
    </a>
  );
}
