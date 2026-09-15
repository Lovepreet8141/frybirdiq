"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One full-bleed chapter video, lazy by default.
 *
 * The element exists from first render (so its poster paints immediately,
 * and its space is reserved — no layout shift), but the actual clip is not
 * requested until the chapter is close to the viewport, and it plays only
 * while in view. Three ~2.5–6.5 MB clips on one page would otherwise all
 * start downloading the moment the hero mounts, which is the wrong trade on
 * a phone network for chapters 2 and 3, seen seconds or minutes later, if
 * at all.
 *
 * Under `prefers-reduced-motion` nothing plays — the poster is the whole
 * chapter, same still frame the video would open on.
 */
export function ChapterVideo({
  desktopSrc,
  mobileSrc,
  poster,
  eager = false,
  className,
}: {
  readonly desktopSrc: string;
  readonly mobileSrc: string;
  readonly poster: string;
  /** True only for the first chapter — it is the hero, so it loads and plays right away. */
  readonly eager?: boolean;
  readonly className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(eager);

  useEffect(() => {
    if (eager) return;
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setArmed(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setArmed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "60% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    const video = videoRef.current;
    const node = wrapperRef.current;
    if (!video || !node || !armed || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [armed]);

  return (
    <div ref={wrapperRef} className={className}>
      {armed ? (
        <video
          ref={videoRef}
          poster={poster}
          muted
          loop
          playsInline
          preload={eager ? "auto" : "metadata"}
          autoPlay={eager}
          className="h-full w-full object-cover"
        >
          <source media="(max-width: 767px)" src={mobileSrc} />
          <source src={desktopSrc} />
        </video>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a plain poster frame, not an optimised content image
        <img src={poster} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );
}
