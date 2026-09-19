import { absoluteUrl } from "./site";

export interface ShareImage {
  readonly url: string;
  readonly alt: string;
}

/**
 * The picture a shared link to an item shows: the item's own photo, or the
 * site-wide share image when it has none. Never empty, because an item page's
 * own `openGraph` object replaces the root layout's — omitting `images` here
 * would leave the link with no picture at all.
 */
export function itemShareImage(image: ShareImage | null | undefined, itemName: string): ShareImage {
  if (image) return { url: image.url.startsWith("http") ? image.url : absoluteUrl(image.url), alt: image.alt };
  return { url: absoluteUrl("/opengraph-image"), alt: `${itemName} at FRYBIRD, Sector 9, Ambala City` };
}
