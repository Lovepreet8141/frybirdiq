import type { Metadata, Viewport } from "next";
import { Archivo, Baloo_2, Inter } from "next/font/google";
import "./globals.css";

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

const baloo = Baloo_2({
  variable: "--font-devanagari",
  subsets: ["devanagari", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "FRYBIRD",
    template: "%s · FRYBIRD",
  },
  description: "Born crispy. Built bold. Fried chicken in Sector 9, Ambala City.",
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
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${baloo.variable} h-full`}>
      <head>
        {/* Scroll reveals start at opacity 0. Without JS the animation never
            runs and the page would render blank below the hero, so the styles
            are undone entirely when scripting is off. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
