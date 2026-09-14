"use client";

import { cn } from "@/lib/utils";

/**
 * "Open FRYBIRD POS": on Android an intent link that opens the installed
 * app (package tech.frybirdiq.pos) and falls back to the setup guide when
 * it is not installed. Elsewhere, the guide.
 */
export function OpenPosAppLink({ platform, className }: { platform: string | null; className?: string }) {
  const fallback = encodeURIComponent("https://frybirdiq.tech/app/admin/hardware#setup");
  const href = platform === "ANDROID" ? `intent://frybirdiq.tech/app/pos#Intent;scheme=https;package=tech.frybirdiq.pos;S.browser_fallback_url=${fallback};end` : "#setup";
  return (
    <a href={href} className={cn("inline-flex min-h-[32px] items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80", className)}>
      {platform === "ANDROID" ? "Open FRYBIRD POS" : "How to install FRYBIRD POS"}
    </a>
  );
}
