"use client";

/**
 * Mounts the 3D badge, or doesn't.
 *
 * design-system/3d.md: "Dynamically imported. Three.js never enters the bundle
 * for a page that does not render it, and never for the customer's critical
 * path." and "Loads after critical content. It never blocks LCP."
 *
 * So the import is deferred twice over — `next/dynamic` with `ssr: false`
 * keeps three.js out of the server render and out of the initial chunk, and
 * the mount waits for an idle callback so the hero text and the order button
 * have already painted before ~150 KB of renderer is fetched.
 *
 * The poster is a CSS badge, not a placeholder. If WebGL never arrives it is
 * the final state of the hero and has to look deliberate.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

const BadgeScene = dynamic(() => import("./badge-scene"), { ssr: false });

export function HeroBadge() {
  const [mount, setMount] = useState(false);
  const [live, setLive] = useState(false);

  // Stable, so the scene effect does not re-run and rebuild the GPU context
  // the moment it reports its first frame.
  const handleReady = useCallback(() => setLive(true), []);

  useEffect(() => {
    // A data-saver or very weak device gets the poster and nothing else. The
    // page sells the food either way; that is the test in 3d.md.
    const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData) return;
    if (connection?.effectiveType && /2g/.test(connection.effectiveType)) return;
    if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 2) return;

    // Safari has no requestIdleCallback; a short timeout gets the same
    // "after the important part has painted" behaviour there.
    const canIdle = typeof window.requestIdleCallback === "function";
    const idle: number = canIdle
      ? window.requestIdleCallback(() => setMount(true), { timeout: 2500 })
      : (setTimeout(() => setMount(true), 900) as unknown as number);

    return () => {
      if (canIdle) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The poster. Stays mounted underneath and fades out only once a real
          frame has rendered, so there is never a flash of empty hero. */}
      <div
        className="absolute right-[22%] top-1/2 hidden -translate-y-1/2 transition-opacity duration-500 lg:block"
        style={{ opacity: live ? 0 : 1 }}
      >
        <div className="relative grid size-[min(26rem,29vw)] place-items-center rounded-full bg-[#C21F11] shadow-[0_30px_90px_-20px_rgba(194,31,17,0.6)]">
          <div className="absolute inset-[5%] rounded-full border-[3px] border-[#F2A324]" />
          <div className="absolute inset-[10%] rounded-full border border-[rgba(245,237,216,0.35)]" />
          <span className="px-6 text-center font-heading text-[clamp(1.6rem,3.4vw,2.8rem)] font-black leading-none tracking-tight text-[#F5EDD8]">
            FRYBIRD
          </span>
          <span className="absolute bottom-[16%] text-[0.6rem] font-semibold tracking-[0.22em] text-[rgba(245,237,216,0.6)]">
            SECTOR 9 · AMBALA CITY
          </span>
        </div>
      </div>

      {/* Pointer events only on the canvas, so the badge is draggable without
          the wrapper swallowing clicks meant for the buttons behind it. */}
      {mount && (
        <div className="pointer-events-auto absolute inset-0 hidden lg:block">
          <BadgeScene onReady={handleReady} />
        </div>
      )}
    </div>
  );
}
