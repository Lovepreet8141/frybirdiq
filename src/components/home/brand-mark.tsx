import { LOGO } from "@/lib/home/logo";

/**
 * The wordmark as a sign switching on: the letterforms draw themselves in
 * stroke first, the cream floods the outlines, and the golden I lands last
 * and stays lit. Same trick as the Sector 9 map — real outlines, normalised
 * to pathLength 1 so a single dashoffset sweep draws the whole word.
 */
export function BrandMark() {
  return (
    <div className="fb-brandmark" data-reveal="">
      <svg
        aria-label="FRYBIRD"
        className="fb-brandmark__svg"
        role="img"
        viewBox={`0 0 1000 ${LOGO.height}`}
      >
        <g className="fb-brandmark__ink">
          <path className="fb-brandmark__fill" d={LOGO.letters} fillRule="evenodd" />
          <path className="fb-brandmark__stroke" d={LOGO.letters} fillRule="evenodd" pathLength="1" />
        </g>
        <g className="fb-brandmark__gold">
          <path className="fb-brandmark__i-fill" d={LOGO.i} />
          <path className="fb-brandmark__i-stroke" d={LOGO.i} pathLength="1" />
        </g>
      </svg>
      <p className="fb-brandmark__tagline">Born crispy. Built bold.</p>
    </div>
  );
}
