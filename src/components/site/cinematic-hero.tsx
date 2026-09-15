import Link from "next/link";
import { ChapterVideo } from "./chapter-video";
import { Reveal } from "@/components/motion/reveal";

/**
 * The hero: one hand-breaded piece of chicken, three chapters, told the way
 * the brand's own shoot told it — spotlight rising, camera closer, heat
 * building. Real footage from FRYBIRD's own production, not stock.
 *
 * This trades the literal pinned scroll-scrub of the original cinema-tier
 * concept for three consecutive full-bleed chapters that reveal on normal
 * scroll: a pin-and-scrub rig is one of the highest-risk pieces of web
 * engineering to ship unseen (scroll-jacking, iOS video-seek limits, a
 * sticky header it has to coexist with) and this codebase has no browser to
 * verify it in. Every other beat of the concept survives — the footage, the
 * three-chapter copy, the alignment per chapter, the spotlight mood — on a
 * mechanism that degrades to "just scroll" for absolutely everyone.
 *
 * Chapter 1's clip autoplays; chapters 2 and 3 are muted/looped and start
 * only once nearly in view (`ChapterVideo`), and under reduced motion every
 * chapter is its still poster frame, motionless, full stop.
 */
export function CinematicHero({ heroStats }: { heroStats: readonly { label: string; value: string }[] }) {
  return (
    <>
      <section className="relative flex min-h-[92vh] items-end overflow-hidden bg-[var(--ink)] text-[var(--cream-hi)] sm:min-h-screen">
        <ChapterVideo
          eager
          desktopSrc="/hero/scene-01.mp4"
          mobileSrc="/hero/scene-01-mobile.mp4"
          poster="/hero/scene-01-poster.jpg"
          className="absolute inset-0"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,rgba(31,7,5,0.92)_0%,rgba(31,7,5,0.55)_38%,rgba(31,7,5,0.15)_65%,rgba(31,7,5,0.45)_100%)]" />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-[var(--gutter)] pb-14 pt-28 sm:pb-20">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[var(--cream-2)]/75">Sector 9 · Ambala City</p>
          <h1 className="mt-4 max-w-2xl font-heading text-[clamp(2.75rem,9vw,6.5rem)] font-black italic leading-[0.92] tracking-tight [font-stretch:75%]">
            Born crispy.
            <span className="block text-primary">Built bold.</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-[var(--cream-2)]/90 sm:text-lg">
            Hand-breaded chicken, fried after you order — never before — in Sector 9, Ambala City.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/menu"
              className="inline-flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-xl border-[2.5px] border-[var(--cream-hi)] bg-primary px-7 font-heading text-base font-extrabold text-primary-foreground shadow-[5px_5px_0_var(--red-deep)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[7px_8px_0_var(--red-deep)] active:translate-y-0.5 active:shadow-[2px_2px_0_var(--red-deep)]"
            >
              Order now
            </Link>
            <Link
              href="#menu"
              className="inline-flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-xl border-[2.5px] border-[var(--cream-hi)]/70 bg-transparent px-7 font-heading text-base font-extrabold text-[var(--cream-hi)] transition-colors duration-200 ease-out hover:bg-[var(--cream-hi)]/10"
            >
              See the menu
            </Link>
          </div>

          {heroStats.length > 0 && (
            <dl className="mt-10 grid w-full max-w-md grid-cols-3 gap-4 border-t border-[var(--cream-hi)]/15 pt-6">
              {heroStats.map((stat) => (
                <div key={stat.label}>
                  <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--cream-2)]/60">{stat.label}</dt>
                  <dd className="tabular mt-1 font-heading text-base font-bold sm:text-lg">{stat.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <section className="relative flex min-h-[80vh] items-center overflow-hidden bg-[var(--ink)] text-[var(--cream-hi)]">
        <ChapterVideo
          desktopSrc="/hero/scene-02.mp4"
          mobileSrc="/hero/scene-02-mobile.mp4"
          poster="/hero/scene-02-poster.jpg"
          className="absolute inset-0"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(100deg,rgba(31,7,5,0.9)_0%,rgba(31,7,5,0.35)_45%,rgba(31,7,5,0.05)_75%)]" />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-[var(--gutter)] py-20">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Twelve hours</p>
            <h2 className="mt-3 max-w-lg font-heading text-[clamp(2rem,5.5vw,3.75rem)] font-black italic leading-[0.98] tracking-tight [font-stretch:75%]">
              Brined twelve hours.
              <span className="block">Fried in fifteen minutes.</span>
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--cream-2)]/90">
              Buttermilk brine overnight, hand-dredged in the FRYBIRD blend, dropped in the fryer only when your order comes in.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {["Hand-breaded", "Double-fried", "Never pre-fried"].map((tag) => (
                <li key={tag} className="rounded-full border border-[var(--cream-hi)]/30 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--cream-2)]/85">
                  {tag}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="relative flex min-h-[80vh] items-center overflow-hidden bg-[var(--ink)] text-[var(--cream-hi)]">
        <ChapterVideo
          desktopSrc="/hero/scene-03.mp4"
          mobileSrc="/hero/scene-03-mobile.mp4"
          poster="/hero/scene-03-poster.jpg"
          className="absolute inset-0"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(260deg,rgba(31,7,5,0.9)_0%,rgba(31,7,5,0.35)_45%,rgba(31,7,5,0.05)_75%)]" />

        <div className="relative z-10 mx-auto flex w-full max-w-6xl justify-end px-[var(--gutter)] py-20">
          <Reveal className="max-w-lg text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Heat</p>
            <h2 className="mt-3 font-heading text-[clamp(2rem,5.5vw,3.75rem)] font-black italic leading-[0.98] tracking-tight [font-stretch:75%]">
              Heat that builds.
              <span className="block">Not burns.</span>
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--cream-2)]/90">
              Classic for the crunch. Nashville for the slow fire.
            </p>
            <ul className="mt-6 flex flex-wrap justify-end gap-2">
              {["Classic", "Nashville"].map((tag) => (
                <li key={tag} className="rounded-full border border-[var(--cream-hi)]/30 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--cream-2)]/85">
                  {tag}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>
    </>
  );
}
