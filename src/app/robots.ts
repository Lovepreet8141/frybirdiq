import type { MetadataRoute } from "next";
import { absoluteUrl, PRIVATE_PATHS } from "@/lib/seo/site";

/**
 * Same rules the nginx copy serves (deploy/nginx-frybird.conf), plus the
 * sitemap line. In production nginx answers /robots.txt first, so the two
 * must be kept in step; this is what runs anywhere nginx is not in front.
 */
/** Rendered per request, so the origin is never frozen into a build. */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
