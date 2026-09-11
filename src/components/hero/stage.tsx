"use client";

import { useEffect, useRef } from "react";

/**
 * The hero's parallax.
 *
 * The floor tilts and the burger leans with the pointer, and both drift up as
 * the page scrolls. All of it is transform-only and driven from one rAF tick,
 * so the whole effect is a couple of composited layers rather than layout.
 *
 * Under prefers-reduced-motion nothing is bound at all — the scene renders at
 * its resting transform and stays there. Motion is the enhancement; the
 * burger, the price and the order button are not.
 */
export function StageMotion() {
  const raf = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const stage = document.getElementById("fb-stage");
    const floor = document.getElementById("fb-floor");
    const shot = document.getElementById("fb-shot");
    if (!stage || !floor || !shot) return;

    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let sy = 0;

    const queue = () => {
      if (!raf.current) raf.current = requestAnimationFrame(tick);
    };

    function tick() {
      raf.current = 0;
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      const s = Math.min(sy, 600);

      floor!.style.transform = `rotateX(${74 - cy * 2.2 - s * 0.012}deg) translateZ(-40px) translateX(${cx * -26}px)`;
      shot!.style.transform = `translateZ(120px) translateY(${s * -0.16}px) rotateY(${cx * 7}deg) rotateX(${cy * -5}deg)`;

      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) queue();
    }

    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      queue();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      queue();
    };
    const onScroll = () => {
      sy = window.scrollY;
      queue();
    };

    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    tick();

    return () => {
      cancelAnimationFrame(raf.current);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
