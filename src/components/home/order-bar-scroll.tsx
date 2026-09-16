"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * The scroll-triggered slide-up behaviour from frybird-web's OrderBar.
 * Takes plain data (never a function — a Server Component parent can't
 * hand a client component a function to call, only serializable props) so
 * HomeOrderBar itself can stay a Server Component reading the real cart.
 * Nudges once, the first time it appears, then stays still.
 */
export function HomeOrderBarScroll({ hasItems, itemCount }: { hasItems: boolean; itemCount: number }) {
  const [visible, setVisible] = useState(false);
  const nudged = useRef(false);
  const [nudge, setNudge] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const show = window.scrollY > window.innerHeight * 0.7;
      setVisible(show);
      if (show && !nudged.current) {
        nudged.current = true;
        setNudge(true);
        window.setTimeout(() => setNudge(false), 1200);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      aria-hidden={visible ? undefined : "true"}
      className="fb-orderbar"
      data-nudge={nudge ? "true" : "false"}
      data-visible={visible ? "true" : "false"}
    >
      <Link className="fb-btn fb-btn--ink" href="/menu" tabIndex={visible ? 0 : -1}>
        Menu
      </Link>
      <Link className="fb-btn" href={hasItems ? "/cart" : "/menu"} tabIndex={visible ? 0 : -1}>
        {hasItems ? `View order (${itemCount})` : "Order now"}
      </Link>
    </div>
  );
}
