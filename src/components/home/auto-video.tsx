import { useEffect, useRef, useState } from "react";

import { isTouchLayout, reduceMotion } from "@/lib/home/device";

/**
 * Every clip on the page registers here, and this module decides which of
 * them may run. On phones exactly one plays at a time — the one closest to
 * the middle of the screen — which keeps decoding, data and battery to the
 * cost of a single video no matter how many are on the page. On a desktop
 * anything visible may play.
 */
interface Slot {
  ratio: number;
  wants: boolean;
}

const slots = new Map<HTMLVideoElement, Slot>();
let overlays = 0;
let frame = 0;

function soloMode() {
  return isTouchLayout();
}

function apply() {
  frame = 0;
  const solo = soloMode();
  let chosen: HTMLVideoElement | null = null;
  let best = 0;
  if (solo) {
    for (const [video, slot] of slots) {
      if (slot.wants && slot.ratio > best) {
        best = slot.ratio;
        chosen = video;
      }
    }
  }
  const blocked = overlays > 0 || (typeof document !== "undefined" && document.hidden);
  for (const [video, slot] of slots) {
    const should = !blocked && slot.wants && (!solo || video === chosen);
    if (should) {
      if (video.paused) {
        void video.play().catch(() => {
          // iOS Low Power Mode and some data-saver modes refuse autoplay.
          // The poster stays, and the wrapper gets a tap-to-play affordance.
          video.dataset.blocked = "true";
        });
      }
    } else if (!video.paused) {
      video.pause();
    }
  }
}

function schedule() {
  if (frame || typeof window === "undefined") return;
  frame = window.requestAnimationFrame(apply);
}

/** Called by full-screen surfaces so the page behind them goes quiet. */
export function holdPageVideos(): () => void {
  overlays += 1;
  schedule();
  return () => {
    overlays = Math.max(0, overlays - 1);
    schedule();
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", schedule);
}

export interface AutoVideoProps {
  src: string;
  /** A lighter encode for phones; falls back to `src` when absent. */
  mobileSrc?: string;
  poster: string;
  /** Tiny inline JPEG shown, blurred, until the poster paints. */
  lqip?: string;
  className?: string;
  /** "auto" starts fetching at once (hero only); "none" waits for the viewport. */
  preload?: "auto" | "metadata" | "none";
  label?: string;
}

/**
 * A muted, looping clip that plays only while it is the one worth playing.
 * The source is attached in an effect rather than in the markup, so a phone
 * never begins downloading the desktop encode before hydration.
 */
export function AutoVideo({
  src,
  mobileSrc,
  poster,
  lqip,
  className,
  preload = "none",
  label,
}: AutoVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    // Muting must be set on the element, not only as an attribute, or iOS
    // refuses to autoplay.
    video.muted = true;
    video.defaultMuted = true;

    const chosen = mobileSrc && isTouchLayout() ? mobileSrc : src;
    // Attaching the source is what opens the connection, so a clip that is
    // still far down the page never asks the network for anything: the
    // poster carries it until the reader is nearly there.
    const attach = () => {
      if (video.getAttribute("src") === chosen) return;
      video.setAttribute("src", chosen);
      video.load();
    };
    if (preload !== "none") attach();

    if (reduceMotion()) {
      attach();
      return;
    }

    const slot: Slot = { ratio: 0, wants: false };
    slots.set(video, slot);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          slot.ratio = entry.intersectionRatio;
          slot.wants = entry.isIntersecting;
          if (entry.isIntersecting) attach();
        }
        schedule();
      },
      { rootMargin: "80px 0px", threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
    );
    observer.observe(video);

    const onBlocked = () => setBlocked(video.dataset.blocked === "true");
    const watcher = new MutationObserver(onBlocked);
    watcher.observe(video, { attributeFilter: ["data-blocked"], attributes: true });

    return () => {
      observer.disconnect();
      watcher.disconnect();
      slots.delete(video);
      video.pause();
    };
  }, [mobileSrc, preload, src]);

  const play = () => {
    const video = ref.current;
    if (!video) return;
    delete video.dataset.blocked;
    setBlocked(false);
    void video.play().catch(() => setBlocked(true));
  };

  return (
    <span
      className={["fb-clip", className].filter(Boolean).join(" ")}
      style={lqip ? { backgroundImage: `url("${lqip}")` } : undefined}
    >
      <video
        aria-label={label}
        className="fb-clip__video"
        disablePictureInPicture
        loop
        muted
        playsInline
        poster={poster}
        preload={preload}
        ref={ref}
      />
      {blocked ? (
        <button aria-label={`Play ${label ?? "clip"}`} className="fb-clip__play" onClick={play} type="button">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}
