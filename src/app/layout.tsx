import type { Metadata, Viewport } from "next";
import { Archivo, Baloo_2, Instrument_Sans, Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";
import { siteUrl } from "@/lib/seo/site";

/**
 * Three families, each with one job. design-system/MASTER.md §3.
 *
 * Archivo carries the width axis so display type can be widened to echo the
 * wordmark. Baloo 2 is loaded with the Devanagari subset for menu descriptors
 * and is never used for a headline.
 */
const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

/**
 * FRYBIRD IQ (the staff surface) sets in Instrument Sans, with Instrument
 * Serif reserved for money at display size — design-system/MASTER.md §3
 * "IQ". The customer site keeps Archivo and Inter; the variables are
 * loaded once here and bound per surface in globals.css.
 */
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const baloo = Baloo_2({
  variable: "--font-devanagari",
  subsets: ["devanagari", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // Resolves every relative URL below (share image, canonical) to the real
  // origin. SITE_URL is read at runtime; the default is the production domain.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "FRYBIRD",
    template: "%s · FRYBIRD",
  },
  description: "Born crispy. Built bold. Fried chicken in Sector 9, Ambala City.",
  openGraph: {
    type: "website",
    siteName: "FRYBIRD",
    locale: "en_IN",
    title: "FRYBIRD, Ambala City. Born crispy. Built bold.",
    description: "Hand-breaded fried chicken in Sector 9, Ambala City. Burgers, wraps, wings, loaded fries and party boxes, fried after you order.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#1F0705",
  // No maximumScale and no userScalable: false. Blocking zoom fails WCAG 1.4.4
  // and the audience is reading this one-handed on a phone at night.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${baloo.variable} ${instrumentSans.variable} ${instrumentSerif.variable} h-full`}
      /* The inline script below sets data-menu-density on this element before
         hydration, so the server's markup and the client's first read differ
         by design. Without this React reports it as a mismatch on every load. */
      suppressHydrationWarning
    >
      <head>
        {/* Scroll reveals start at opacity 0. Without JS the animation never
            runs and the page would render blank below the hero, so the styles
            are undone entirely when scripting is off. */}
        {/* Applies the remembered menu density before first paint. Without
            it the page renders two-up, hydrates, then reflows to one — a
            visible jump on exactly the screen it is meant to help. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.menuDensity=localStorage.getItem('frybird:menu-density')==='1'?'1':'2'}catch(e){}",
          }}
        />
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
