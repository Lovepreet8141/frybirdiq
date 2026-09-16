"use client";

import { useEffect, useRef } from "react";

import { isFinePointer, reduceMotion } from "@/lib/home/device";
import { LQIP } from "@/lib/home/lqip";

import { AutoVideo } from "./auto-video";
import { OrderLine } from "./ctas";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface HeroStat {
  readonly label: string;
  readonly value: string;
}

/**
 * Ported from frybird-web's src/components/site/hero.tsx, near-verbatim.
 * The clip is not framed: its own yellow backdrop is the section's colour
 * and its edges are feathered away, so the bowl simply sits on the page.
 * It leans toward whatever is steering — a cursor on a desktop, the
 * phone's own tilt on Android — and sinks away as the page scrolls,
 * so leaving the hero reads as a camera move rather than a jump.
 *
 * iOS is deliberately left out of the tilt: Safari makes a site ask
 * permission for motion data, and a permission dialog on a chicken shop is
 * a worse trade than the effect is worth. iPhones get the scroll move,
 * which is the part everyone sees anyway.
 *
 * `city` and `stats` are the one adaptation: frybird-web hardcoded
 * "Sector 9, Ambala City" and a static kitchen-hours line. Both are now
 * read from the real organization settings by the homepage server
 * component and passed down, so a change in Restaurant Settings shows
 * here without editing this file.
 */
export function Hero({ city, stats }: { city: string; stats: readonly HeroStat[] }) {
  const sectionRef = useRef<HTMLElement>(null);
  const filmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const film = filmRef.current;
    if (!section || !film || reduceMotion()) return;

    let leanX = 0;
    let leanY = 0;
    let currentX = 0;
    let currentY = 0;
    let frame = 0;
    let alive = true;

    const draw = () => {
      frame = 0;
      if (!alive) return;
      currentX += (leanX - currentX) * 0.08;
      currentY += (leanY - currentY) * 0.08;

      const height = window.innerHeight || 1;
      const progress = clamp(window.scrollY / height, 0, 1);
      const sink = progress * height * 0.22;
      const shrink = 1 - progress * 0.12;

      film.style.transform =
        `translate3d(${(currentX * 16).toFixed(2)}px, ${(sink + currentY * 12).toFixed(2)}px, 0) ` +
        `rotateY(${(currentX * 6).toFixed(2)}deg) rotateX(${(-currentY * 4).toFixed(2)}deg) ` +
        `scale(${shrink.toFixed(3)})`;
      section.style.setProperty("--hero-progress", progress.toFixed(3));

      const settled =
        Math.abs(leanX - currentX) < 0.0015 && Math.abs(leanY - currentY) < 0.0015;
      if (!settled) frame = requestAnimationFrame(draw);
    };

    const wake = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const onPointer = (event: PointerEvent) => {
      const rect = section.getBoundingClientRect();
      leanX = clamp((event.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5);
      leanY = clamp((event.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
      wake();
    };
    const onLeave = () => {
      leanX = 0;
      leanY = 0;
      wake();
    };
    const onTilt = (event: DeviceOrientationEvent) => {
      // gamma: left/right tilt, beta: front/back. Both in degrees.
      leanX = clamp((event.gamma ?? 0) / 45, -0.5, 0.5);
      leanY = clamp(((event.beta ?? 45) - 45) / 60, -0.5, 0.5);
      wake();
    };

    const fine = isFinePointer();
    if (fine) {
      section.addEventListener("pointermove", onPointer);
      section.addEventListener("pointerleave", onLeave);
    } else if (
      typeof DeviceOrientationEvent !== "undefined" &&
      // Safari gates this behind a permission prompt; only wire it up where
      // the browser hands the data over without asking.
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission !==
        "function"
    ) {
      window.addEventListener("deviceorientation", onTilt);
    }

    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", wake);
    wake();

    return () => {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      section.removeEventListener("pointermove", onPointer);
      section.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("deviceorientation", onTilt);
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", wake);
    };
  }, []);

  return (
    <section className="fb-hero" id="top" ref={sectionRef}>
      <div className="fb-wrap fb-hero__grid">
        <div className="fb-hero__copy">
          <p className="fb-eyebrow fb-eyebrow--hero">Sector 9, {city}</p>
          <h1 className="fb-display fb-hero__title">
            Born crispy.
            <span className="fb-hero__accent">Built bold.</span>
          </h1>
          <p className="fb-hero__lead">
            Hand-breaded, double-fried chicken. Fried after you order, never before.
          </p>
          <OrderLine />
        </div>

        <div aria-hidden="true" className="fb-hero__stage">
          <div className="fb-hero__film" ref={filmRef}>
            <AutoVideo
              className="fb-hero__video"
              label="Cheese sauce poured over FRYBIRD loaded fries"
              lqip={LQIP.hero}
              mobileSrc="/home/video/hero-m.mp4"
              poster="/home/video/hero.jpg"
              preload="auto"
              src="/home/video/hero.mp4"
            />
          </div>
        </div>

        <dl className="fb-hero__stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <a aria-label="Scroll to the bestsellers" className="fb-hero__cue" href="#bestsellers">
        <span>Scroll</span>
        <i />
      </a>
    </section>
  );
}
