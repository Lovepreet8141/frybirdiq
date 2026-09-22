import type { MetadataRoute } from "next";

/**
 * The installable-app manifest (Rider PWA). Scoped to the staff area, `/app`, not the customer site: the screen
 * worth pinning to a home-screen icon is the rider's own Deliveries screen, which has to stay open and awake while
 * sharing location (`src/components/staff/share-location.tsx`, roadmap Lane B) — a browser tab a phone's gesture
 * nav can swipe away by mistake is exactly the wrong shape for that. Installing from any `/app` page (a manager's,
 * a cashier's) works the same way; this manifest does not gate who can install, only where the installed app opens.
 *
 * Icons are static PNGs under `public/pwa/`, not generated per request — the same reasoning as `src/app/icon.svg`'s
 * comment: a route trying to write a prerender cache to a read-only path on every load is a real production failure,
 * not a hypothetical one, so a manifest-referenced icon stays a plain static file.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FRYBIRD IQ",
    short_name: "FRYBIRD",
    description: "FRYBIRD staff app — orders, kitchen, deliveries.",
    start_url: "/app",
    scope: "/app",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f5f6",
    theme_color: "#d92b2b",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
