"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

import { lockScroll, reduceMotion } from "@/lib/home/device";
import { rupees } from "@/lib/home/format";

import { holdPageVideos } from "./auto-video";
import type { HomeBestseller } from "./bestsellers";

interface ReelsProps {
  items: readonly HomeBestseller[];
  startIndex: number;
  onClose: () => void;
}

/**
 * Ported from frybird-web's src/components/site/reels.tsx, near-verbatim.
 * The dish, full screen, the way a phone owner already watches food: one
 * tall clip at a time, swipe up for the next, price and Order sitting
 * over it. Native scroll-snap does the paging.
 */
export function Reels({ items, startIndex, onClose }: ReelsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const release = holdPageVideos();
    const unlock = lockScroll();
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      unlock();
      release();
    };
  }, [onClose]);

  // Open on the dish that was tapped, without animating past the others.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTop = track.clientHeight * startIndex;
  }, [startIndex]);

  // Play only the slide filling the screen.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const videos = [...track.querySelectorAll<HTMLVideoElement>("video")];
    for (const video of videos) {
      video.muted = true;
      video.defaultMuted = true;
    }
    if (reduceMotion()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target as HTMLVideoElement;
          if (entry.intersectionRatio > 0.6) {
            video.currentTime = 0;
            void video.play().catch(() => {});
          } else {
            video.pause();
          }
        }
      },
      { root: track, threshold: [0, 0.6, 1] },
    );
    for (const video of videos) observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <div aria-label="Bestsellers" aria-modal="true" className="fb-reels" role="dialog">
      <button aria-label="Close" className="fb-reels__close" onClick={onClose} ref={closeRef} type="button">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className="fb-reels__track" ref={trackRef}>
        {items.map((item) => (
          <article className="fb-reels__slide" key={item.slug}>
            <video
              className="fb-reels__video"
              disablePictureInPicture
              loop
              muted
              playsInline
              poster={item.poster}
              preload="none"
              src={item.video}
            />
            <div className="fb-reels__scrim" />
            <div className="fb-reels__copy">
              <span className="fb-reels__tag">{item.tag}</span>
              <h2 className="fb-reels__name">{item.name}</h2>
              <p className="fb-reels__note">{item.note}</p>
              <div className="fb-reels__row">
                <span className="fb-reels__price">{rupees(item.price)}</span>
                <Link className="fb-btn" href="/menu">
                  Order now
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>

      <p aria-hidden="true" className="fb-reels__hint">
        Swipe up for the next
      </p>
    </div>
  );
}
