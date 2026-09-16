import Image from "next/image";
import type { CSSProperties } from "react";

interface SiteWordmarkProps {
  /** Which background this sits on — picks the matching official variant, not one logo forced onto both grounds. */
  readonly tone: "light" | "dark";
  readonly className?: string;
  readonly priority?: boolean;
}

const I_STYLE: CSSProperties = { top: "2.135%", left: "62.006%", width: "5.731%", height: "95.73%" };

/**
 * The FRYBIRD wordmark, shared by every customer-facing shell surface —
 * Header and Footer, which every route under src/app/(site)/layout.tsx
 * renders through.
 *
 * Two official variants:
 * - `light`: ink lettering with the red "I", for the site's light cream
 *   chrome. `frybird-wordmark-ink.svg` — confirmed byte-identical to
 *   frybird-web's own `refs/unused/wordmark-ink.svg`, not invented here.
 * - `dark`: cream lettering with the gold "I", for dark chrome. The same
 *   two layered PNGs the homepage header uses
 *   (public/home/brand/wm-letters.png + wm-i.png), positioned the same way
 *   `(home)/frybird-home.css`'s `.fb-mark` does — reimplemented inline
 *   rather than importing that stylesheet globally, since it's
 *   intentionally scoped to the homepage route only.
 *
 * The homepage's own `Wordmark`/`BrandMark` (src/components/home/) are
 * untouched and out of scope — they already are this exact treatment.
 */
export function SiteWordmark({ tone, className, priority }: SiteWordmarkProps) {
  if (tone === "light") {
    return (
      <Image
        alt="FRYBIRD"
        className={className}
        height={30}
        priority={priority}
        src="/frybird-wordmark-ink.svg"
        width={132}
      />
    );
  }

  return (
    <span
      aria-label="FRYBIRD"
      className={["relative inline-block", className].filter(Boolean).join(" ")}
      role="img"
      style={{ aspectRatio: "900 / 145" }}
    >
      <img alt="" className="block h-full w-full" height={145} src="/home/brand/wm-letters.png" width={900} />
      <img alt="" className="absolute" height={269} src="/home/brand/wm-i.png" style={I_STYLE} width={100} />
    </span>
  );
}
