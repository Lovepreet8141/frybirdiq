/**
 * The site's own origin, for canonical links, the sitemap and share tags.
 *
 * Read from SITE_URL, but only when it is a public https origin. Some of these
 * surfaces are rendered once at build time, and a build made on a laptop with
 * SITE_URL=http://localhost:3000 would otherwise publish localhost canonicals
 * and a localhost sitemap to Google, with nothing failing anywhere. A value
 * that is not https, or names localhost / a loopback or private address, is
 * ignored and the production domain is used instead.
 */
export const DEFAULT_SITE_URL = "https://frybirdiq.tech";

const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|\[::1\])/i;

export function siteUrl(): string {
  const raw = process.env.SITE_URL?.trim().replace(/\/$/, "");
  if (!raw) return DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || LOCAL_HOST.test(url.hostname)) return DEFAULT_SITE_URL;
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** An absolute URL on this site for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Routes a crawler must never index: the staff area, a customer's own
 * account and orders, and checkout. One list, used by robots.ts and (as the
 * reference for) the nginx copy in deploy/nginx-frybird.conf.
 */
export const PRIVATE_PATHS = ["/app/", "/account/", "/order/", "/checkout"] as const;
