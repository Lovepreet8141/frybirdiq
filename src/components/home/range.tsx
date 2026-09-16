import type { CSSProperties } from "react";
import Link from "next/link";

/** Ported from frybird-web's src/components/site/range.tsx. Static marketing copy and photography — nothing here is restaurant operations data. */
export function Range() {
  return (
    <section className="fb-section fb-range" id="range">
      <div className="fb-wrap fb-range__grid">
        <figure className="fb-range__media" data-parallax="0.05">
          <img
            height="1792"
            width="2400"
            alt="The FRYBIRD range: loaded fries, popcorn chicken box, crispy chicken burger, tenders, wrap and three dips"
            decoding="async"
            sizes="(max-width: 860px) 100vw, 55vw"
            src="/home/video/range.jpg"
            srcSet="/home/video/range-900.jpg 900w, /home/video/range.jpg 1800w"
          />
        </figure>
        <div className="fb-range__copy" data-reveal="" style={{ "--reveal-delay": "120ms" } as CSSProperties}>
          <p className="fb-eyebrow">Fried when you order</p>
          <h2 className="fb-display fb-range__title">Nothing waits under a heat lamp.</h2>
          <p className="fb-range__text">
            Every piece goes into the fryer after your order comes in. Dahi brine overnight, hand-dredged in our own
            masala blend, double-fried for the crunch. Burgers, wraps, wings, tenders, loaded fries, mac and rice bowls,
            with three heats to pick from.
          </p>
          <div className="fb-hero-actions">
            <Link className="fb-btn fb-btn--ink" href="/menu">
              See the full menu
            </Link>
            <Link className="fb-btn" href="/menu">
              Order now
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
