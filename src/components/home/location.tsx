import { MAP } from "@/lib/home/map";

import { Wordmark } from "./wordmark";

/**
 * Adapted from frybird-web's src/components/site/location.tsx. The drawn
 * SVG map geometry (real OpenStreetMap road data for Sector 9) is
 * preserved verbatim — it's cartographic art, not a data-driven chart. The
 * two rings stay their original decorative radii rather than being
 * recomputed to the real delivery distance: FRYBIRD IQ's actual last band
 * can run well past what a 1000-unit viewBox can show as a to-scale ring
 * without the drawing breaking. What *is* now real: the address, hours,
 * and delivery-fee copy in the text column, and the "X km delivery" chip
 * on the map itself, both read from Restaurant Settings and the real
 * delivery bands rather than a hardcoded "3 km".
 */

function DirectionsLink({ href }: { href: string }) {
  return (
    <a className="fb-route" href={href} rel="noopener" target="_blank">
      <span>Get directions</span>
      <svg aria-hidden="true" viewBox="0 0 224 24">
        <path className="fb-route__path" d="M0 12 L60 12 L78 3 L120 3 L138 12 L220 12" />
        <path className="fb-route__arrow" d="M-6 -5 L4 0 L-6 5 Z" />
      </svg>
    </a>
  );
}

function PhoneReadout({ display, href }: { display: string; href: string }) {
  return (
    <a className="fb-readout" href={href}>
      <img alt="" className="fb-icon" src="/home/icons/phone.png" />
      <span className="fb-readout__digits">{display}</span>
    </a>
  );
}

function DrawnMap({ addressOneLine, mapsUrl, deliveryChip }: { addressOneLine: string; mapsUrl: string; deliveryChip: string }) {
  return (
    <a aria-label={`FRYBIRD, ${addressOneLine}. Open in Google Maps`} className="fb-map" data-reveal="" href={mapsUrl} rel="noopener" target="_blank">
      <svg aria-hidden="true" className="fb-map__canvas" viewBox="0 0 1000 1000">
        <g className="fb-map__roads">
          <path className="fb-map__line fb-map__line--rail" d={MAP.rail} pathLength="1" />
          <path className="fb-map__line fb-map__line--minor" d={MAP.minor} pathLength="1" />
          <path className="fb-map__line fb-map__line--mid" d={MAP.mid} pathLength="1" />
          <path className="fb-map__line fb-map__line--major" d={MAP.major} pathLength="1" />
        </g>

        <g className="fb-map__rings">
          <circle className="fb-map__ring fb-map__ring--outer" cx="500" cy="500" r={MAP.ring3} />
          <circle className="fb-map__ring fb-map__ring--inner" cx="500" cy="500" r={MAP.ring1} />
        </g>

        <g className="fb-map__radar">
          <circle cx="500" cy="500" r="60" />
          <circle cx="500" cy="500" r="60" />
          <circle cx="500" cy="500" r="60" />
        </g>
      </svg>

      <span aria-hidden="true" className="fb-map__vignette" />

      <span aria-hidden="true" className="fb-map__place">
        <span className="fb-map__label">
          <Wordmark className="fb-map__wordmark" />
          <small>Sector 9</small>
        </span>
        <span className="fb-map__pin">
          <svg viewBox="0 0 48 62">
            <path
              className="fb-map__pin-body"
              d="M24 1.5c12.4 0 22.5 10 22.5 22.4 0 15.3-16.4 30.6-21 34.7a2.3 2.3 0 0 1-3 0c-4.6-4.1-21-19.4-21-34.7C1.5 11.5 11.6 1.5 24 1.5Z"
            />
            <circle className="fb-map__pin-eye" cx="24" cy="23" r="7.4" />
          </svg>
        </span>
        <span className="fb-map__stem" />
        <span className="fb-map__shadow" />
      </span>

      <span aria-hidden="true" className="fb-map__radius">
        {deliveryChip}
      </span>

      <span className="fb-map__open">
        Open in Google Maps
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M8 16L16 8M9 8h7v7" />
        </svg>
      </span>

      <span aria-hidden="true" className="fb-map__credit">
        Map data © OpenStreetMap
      </span>
    </a>
  );
}

export interface HomeLocationProps {
  readonly hoursLabel: string;
  readonly hoursValue: string;
  readonly prepTime: string;
  readonly addressLines: readonly string[];
  readonly addressOneLine: string;
  readonly deliveryText: string;
  readonly deliveryChip: string;
  readonly mapsPlaceUrl: string;
  readonly mapsDirectionsUrl: string;
  readonly phoneDisplay: string | null;
  readonly phoneHref: string | null;
}

export function Location({
  hoursLabel,
  hoursValue,
  prepTime,
  addressLines,
  addressOneLine,
  deliveryText,
  deliveryChip,
  mapsPlaceUrl,
  mapsDirectionsUrl,
  phoneDisplay,
  phoneHref,
}: HomeLocationProps) {
  return (
    <section className="fb-section fb-where" id="find-us">
      <div className="fb-wrap fb-where__grid">
        <DrawnMap addressOneLine={addressOneLine} deliveryChip={deliveryChip} mapsUrl={mapsPlaceUrl} />

        <div className="fb-where__copy" data-reveal="">
          <p className="fb-eyebrow">Find us</p>
          <h2 className="fb-display fb-where__title">Sector 9, Ambala City</h2>
          <dl className="fb-where__rows">
            <div className="fb-where__row">
              <dt>
                <img alt="" className="fb-icon" src="/home/icons/clock.png" />
              </dt>
              <dd>
                <span>
                  {hoursLabel}, {hoursValue}
                </span>
                <span className="muted">{prepTime}</span>
              </dd>
            </div>
            <div className="fb-where__row">
              <dt>
                <img alt="" className="fb-icon" src="/home/icons/pin.png" />
              </dt>
              <dd>
                {addressLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </dd>
            </div>
            <div className="fb-where__row">
              <dt>
                <img alt="" className="fb-icon" src="/home/icons/scooter.png" />
              </dt>
              <dd>
                <span className="muted">{deliveryText}</span>
              </dd>
            </div>
          </dl>
          <div className="fb-where__actions">
            <DirectionsLink href={mapsDirectionsUrl} />
            {phoneDisplay && phoneHref ? <PhoneReadout display={phoneDisplay} href={phoneHref} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
