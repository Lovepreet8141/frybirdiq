import type { CSSProperties } from "react";

import { BrandMark } from "./brand-mark";

/** Ported from frybird-web's src/components/site/story.tsx, verbatim beyond asset paths. Static marketing copy. */
export function Story() {
  return (
    <section className="fb-section fb-story" id="story">
      <div className="fb-wrap">
        <div className="fb-story__grid">
          <div data-reveal="">
            <BrandMark />
            <h2 className="fb-display fb-story__statement">
              Asli crunch.
              <br />
              Asli swaad.
              <br />
              Asli India.
            </h2>
            <p className="fb-story__text">
              FRYBIRD is a specialist chicken house from Sector 9, Ambala City. Dahi-brined overnight, hand-dredged in
              our own masala blend, dropped in the fryer only after you order. No warming trays, no pre-fried anything.
            </p>
            <p className="fb-story__text">
              Built in Ambala to grow across Punjab and Haryana: one recipe, one standard, every shop.
            </p>
          </div>
        </div>
        <ul className="fb-facts" aria-label="How FRYBIRD cooks">
          <li data-reveal="" style={{ "--reveal-delay": "0ms" } as CSSProperties}>
            <img alt="" className="fb-facts__icon" src="/home/icons/drumstick.png" />
            <strong data-count="12" data-suffix=" hrs">12 hrs</strong>
            <span>In the brine</span>
          </li>
          <li data-reveal="" style={{ "--reveal-delay": "90ms" } as CSSProperties}>
            <img alt="" className="fb-facts__icon" src="/home/icons/clock.png" />
            <strong data-count="15" data-suffix=" min">15 min</strong>
            <span>Order to pickup</span>
          </li>
          <li data-reveal="" style={{ "--reveal-delay": "180ms" } as CSSProperties}>
            <img alt="" className="fb-facts__icon" src="/home/icons/flame.png" />
            <strong data-count="3" data-suffix=" heats">3 heats</strong>
            <span>Classic, Grazy Bird, Nashville</span>
          </li>
          <li data-reveal="" style={{ "--reveal-delay": "270ms" } as CSSProperties}>
            <img alt="" className="fb-facts__icon" src="/home/icons/box.png" />
            <strong>Sector 9</strong>
            <span>Pick-up or delivery, Ambala City</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
