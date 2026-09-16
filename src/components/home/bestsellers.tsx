"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";

import { LQIP } from "@/lib/home/lqip";
import { rupees } from "@/lib/home/format";
import { buzz } from "@/lib/home/device";

import { AutoVideo } from "./auto-video";
import { Reels } from "./reels";

export interface HomeBestseller {
  readonly slug: string;
  readonly name: string;
  readonly tag: string;
  readonly note: string;
  readonly price: number;
  readonly video: string;
  readonly poster: string;
}

/**
 * Adapted from frybird-web's src/components/site/bestsellers.tsx. Same
 * grid, same watch-a-clip interaction (Reels), same six-item showcase
 * shape — but `items` is now real, resolved server-side by the homepage
 * from `getAllProducts("ONLINE")` (see src/app/(home)/page.tsx). Which six
 * *slugs* to feature stays an editorial choice, same as the rest of the
 * site's curated picks — FRYBIRD IQ has no "featured" flag to be
 * authoritative over — but each slot's name, price and description are
 * FRYBIRD IQ's own, and a slot whose product isn't currently available is
 * never passed in at all (never shown as orderable).
 */
export function Bestsellers({ items }: { items: readonly HomeBestseller[] }) {
  const [reel, setReel] = useState<number | null>(null);

  const open = (index: number) => {
    buzz();
    setReel(index);
  };

  return (
    <section className="fb-section fb-best" id="bestsellers">
      <div className="fb-wrap">
        <div className="fb-best__head" data-reveal="">
          <div>
            <p className="fb-eyebrow">The bestsellers</p>
            <h2 className="fb-display fb-best__title">What Ambala keeps coming back for.</h2>
          </div>
          <p className="fb-best__note">
            Plates that leave the pass every few minutes. Tap one to watch it, or open the full menu.
          </p>
        </div>

        <ul className="fb-best__grid" aria-label="Bestsellers">
          {items.map((item, index) => (
            <li
              className="fb-best__card"
              data-reveal="scale"
              key={item.slug}
              style={{ "--reveal-delay": `${(index % 3) * 110}ms` } as CSSProperties}
            >
              <button
                aria-label={`Watch ${item.name}`}
                className="fb-best__media"
                onClick={() => open(index)}
                type="button"
              >
                <AutoVideo label={item.name} lqip={LQIP[item.slug]} poster={item.poster} src={item.video} />
                <span className="fb-best__tag">{item.tag}</span>
                <span aria-hidden="true" className="fb-best__watch">
                  <svg viewBox="0 0 24 24">
                    <path d="M8 5.5v13l11-6.5z" />
                  </svg>
                </span>
              </button>
              <div className="fb-best__body">
                <h3 className="fb-best__name">{item.name}</h3>
                <p className="fb-best__note-text">{item.note}</p>
                <div className="fb-best__row">
                  <span className="fb-best__price">{rupees(item.price)}</span>
                  <Link className="fb-btn fb-btn--small" href={`/item/${item.slug}`} onClick={() => buzz()}>
                    Order
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="fb-best__foot" data-reveal="">
          <Link className="fb-btn fb-btn--ink" href="/menu">
            See the full menu
          </Link>
        </div>
      </div>

      {reel === null ? null : (
        <Reels items={items} onClose={() => setReel(null)} startIndex={reel} />
      )}
    </section>
  );
}
