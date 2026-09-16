/**
 * Ported verbatim from frybird-web's src/components/site/wordmark.tsx — the
 * FRYBIRD wordmark from the brand's own logo file, in two layers so the
 * golden I can drop into place on first paint. Asset paths point at
 * /home/brand (copied from frybird-web's public/assets/brand).
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={["fb-mark", className].filter(Boolean).join(" ")} role="img" aria-label="FRYBIRD">
      <img alt="" className="fb-mark__letters" decoding="async" height="145" src="/home/brand/wm-letters.png" width="900" />
      <img alt="" className="fb-mark__i" decoding="async" height="269" src="/home/brand/wm-i.png" width="100" />
    </span>
  );
}
