import { Wordmark } from "./wordmark";

/**
 * Adapted from frybird-web's src/components/site/footer.tsx. Hours and
 * address are now real data (props from the homepage's own server-side
 * read), not the static SITE constant frybird-web carried. Instagram
 * handle stays as genuine static brand copy — it isn't restaurant
 * operations data Menu Control Center owns.
 */
const INSTAGRAM_HANDLE = "frybirdindia";
const INSTAGRAM_URL = "https://www.instagram.com/frybirdindia/";

function FollowSplit() {
  return (
    <a className="fb-split" href={INSTAGRAM_URL} rel="noopener" target="_blank">
      <span className="fb-split__left">Follow</span>
      <span className="fb-split__right">FRYBIRD</span>
      <span className="fb-split__handle">@{INSTAGRAM_HANDLE}</span>
    </a>
  );
}

export interface HomeFooterProps {
  readonly hoursLabel: string;
  readonly hoursValue: string;
  readonly addressLines: readonly string[];
  readonly city: string;
}

export function HomeFooter({ hoursLabel, hoursValue, addressLines, city }: HomeFooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer className="fb-section fb-footer">
      <div className="fb-wrap">
        <div className="fb-footer__grid">
          <div>
            <Wordmark className="fb-footer__logo" />
            <FollowSplit />
          </div>
          <div>
            <h3>Hours</h3>
            <p>
              {hoursLabel}
              <br />
              {hoursValue}
            </p>
          </div>
          <div>
            <h3>Address</h3>
            <p>
              {addressLines.map((line) => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
            </p>
          </div>
        </div>
        <div className="fb-footer__bottom">
          <span>
            {year} FRYBIRD, {city}
          </span>
          <span>Specialist chicken house</span>
        </div>
      </div>
    </footer>
  );
}
