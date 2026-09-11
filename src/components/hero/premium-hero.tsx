"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * The hero. One confident headline, one product photograph, one decision.
 *
 * Replaces the old pointer-tilted "stage": a checkerboard floor tilted in
 * 3D and dragged around by the cursor, with an oversized translucent
 * wordmark behind it. That read as a toy, not a premium fried-chicken
 * brand — dark, cinematic and still is the actual target per
 * design-system/MASTER.md §2 ("FRYBIRD's identity is cream on charred"),
 * which the old cream-background hero never actually delivered on.
 *
 * Motion here is a single entrance — each piece settles once, on load, at
 * the "hero" duration (560ms, motion.md) — plus one continuous touch: the
 * product photo breathes, barely, the way a plated dish would under a
 * camera that hasn't quite stopped rolling. Nothing here is pointer-driven,
 * and everything collapses to its resting position under reduced motion.
 */
export function PremiumHero({
  productImage,
  stats,
}: {
  productImage: { url: string; alt: string } | null;
  stats: readonly { label: string; value: string }[];
}) {
  const reduced = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-b border-[var(--cream-hi)]/10 bg-[var(--ink)] text-[var(--cream-hi)]">
      <div aria-hidden="true" className="hero-grain" />
      {/* Studio-light glow behind the plate, not a full floor — the one
          piece of "depth" this hero needs. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background:radial-gradient(48%_60%_at_78%_40%,rgba(217,43,43,0.38),transparent_70%)] lg:[background:radial-gradient(38%_55%_at_82%_45%,rgba(217,43,43,0.4),transparent_70%)]"
      />

      <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-[var(--gutter)] pb-16 pt-24 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10 lg:pb-20 lg:pt-32">
        <div className="relative z-10 flex flex-col items-center text-center lg:items-start lg:text-left">
          <motion.p
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className="text-xs font-semibold uppercase tracking-[0.34em] text-[var(--cream-2)]/70"
          >
            Sector 9 · Ambala City
          </motion.p>

          <motion.h1
            initial={reduced ? false : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.56, delay: 0.08, ease: EASE_OUT }}
            className="mt-4 font-heading text-[clamp(2.75rem,8.2vw,6rem)] font-black italic leading-[0.94] tracking-tight"
          >
            Born crispy.
            <span className="block text-primary">Built bold.</span>
          </motion.h1>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18, ease: EASE_OUT }}
            className="mt-5 max-w-md text-base text-[var(--cream-2)]/85 sm:text-lg"
          >
            Hand-breaded, double-fried chicken — brined twelve hours, fried after you order, never before.
          </motion.p>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.28, ease: EASE_OUT }}
            className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start"
          >
            <Link
              href="/menu"
              className="inline-flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-xl border-[2.5px] border-[var(--cream-hi)] bg-primary px-7 font-heading text-base font-extrabold text-primary-foreground shadow-[5px_5px_0_var(--red-deep)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[7px_8px_0_var(--red-deep)] active:translate-y-0.5 active:shadow-[2px_2px_0_var(--red-deep)]"
            >
              Order now
            </Link>
            <Link
              href="#picks"
              className="inline-flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-xl border-[2.5px] border-[var(--cream-hi)]/70 bg-transparent px-7 font-heading text-base font-extrabold text-[var(--cream-hi)] transition-colors duration-200 ease-out hover:bg-[var(--cream-hi)]/10"
            >
              See the menu
            </Link>
          </motion.div>

          {stats.length > 0 && (
            <motion.dl
              initial={reduced ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.38, ease: EASE_OUT }}
              className="mt-10 grid w-full max-w-md grid-cols-3 gap-4 border-t border-[var(--cream-hi)]/15 pt-6 sm:max-w-lg lg:max-w-none"
            >
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--cream-2)]/60">
                    {stat.label}
                  </dt>
                  <dd className="tabular mt-1 font-heading text-base font-bold sm:text-lg">{stat.value}</dd>
                </div>
              ))}
            </motion.dl>
          )}
        </div>

        {productImage && (
          <motion.div
            initial={reduced ? false : { opacity: 0, scale: 0.92, y: 16 }}
            animate={
              reduced
                ? { opacity: 1, scale: 1, y: 0 }
                : { opacity: 1, scale: 1, y: [0, -10, 0] }
            }
            transition={
              reduced
                ? { duration: 0.56, ease: EASE_OUT }
                : {
                    opacity: { duration: 0.56, delay: 0.16, ease: EASE_OUT },
                    scale: { duration: 0.56, delay: 0.16, ease: EASE_OUT },
                    y: { duration: 4.5, delay: 0.7, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" },
                  }
            }
            className="relative z-10 mx-auto w-full max-w-sm lg:mx-0 lg:max-w-[440px]"
          >
            {/* Capped below the source photo's native 640px width — this is
                a cut-out product shot, not a full lifestyle photograph, and
                stretching it further than that upscales visible softness
                into the one thing the hero exists to sell. The extra column
                width becomes breathing room instead, which reads as more
                confident than a bigger, blurrier photo would. */}
            <Image
              src={productImage.url}
              alt={productImage.alt}
              width={640}
              height={640}
              priority
              sizes="(min-width: 1024px) 440px, 80vw"
              className="h-auto w-full drop-shadow-[0_34px_40px_rgba(0,0,0,0.5)]"
            />
          </motion.div>
        )}
      </div>
    </section>
  );
}
