"use client";

import { useEffect } from "react";

/**
 * Ported from frybird-web's src/components/site/motion.tsx, near-verbatim.
 * Page motion, in one place:
 * - `[data-reveal]` elements rise into view once, staggered by `--reveal-delay`.
 * - `[data-parallax]` elements drift a fraction of the scroll (subtle, capped).
 * - `[data-count]` numbers count up from zero the first time they are seen.
 * Everything is skipped when the reader prefers reduced motion, and nothing
 * here is required for the page to read: without JS the content simply shows.
 *
 * One adaptation from the original: frybird-web puts the `fb-js`/`fb-still`
 * marker classes on `<html>`, because that app's `<html>` only ever renders
 * that one site. This app's `<html>` is shared by every customer route, so
 * the markers go on the `.fb` wrapper around just the homepage content
 * instead — src/app/(home)/frybird-home.css's `.fb-js`/`.fb-still` selectors
 * were adapted to match (see that file's header comment).
 */
export function HomeMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".fb");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("fb-js");
    if (reduce) {
      root.classList.add("fb-still");
      return;
    }

    // Reveal on scroll.
    const revealables = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
    const revealer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.revealed = "true";
            revealer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    for (const el of revealables) {
      // Anything already on screen at load shows at once, no wait.
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.9) {
        el.dataset.revealed = "true";
      } else {
        revealer.observe(el);
      }
    }

    // Count up.
    const counters = [...root.querySelectorAll<HTMLElement>("[data-count]")];
    const counter = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          counter.unobserve(el);
          const to = Number(el.dataset.count ?? "0");
          const suffix = el.dataset.suffix ?? "";
          const start = performance.now();
          const duration = 1100;
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - (1 - t) ** 3;
            el.textContent = `${Math.round(to * eased)}${suffix}`;
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 },
    );
    for (const el of counters) counter.observe(el);

    // Parallax drift.
    const drifters = [...root.querySelectorAll<HTMLElement>("[data-parallax]")];
    let frame = 0;
    const drift = () => {
      frame = 0;
      const vh = window.innerHeight;
      for (const el of drifters) {
        const rect = el.getBoundingClientRect();
        const centre = rect.top + rect.height / 2 - vh / 2;
        const amount = Number(el.dataset.parallax ?? "0.08");
        const offset = Math.max(-40, Math.min(40, -centre * amount));
        el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
      }
    };
    const onScroll = () => {
      if (!frame && drifters.length) frame = requestAnimationFrame(drift);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    drift();

    return () => {
      revealer.disconnect();
      counter.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
