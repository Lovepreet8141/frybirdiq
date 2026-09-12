"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useChime } from "./use-chime";

/**
 * Lets someone check the alarm is audible before a shift, rather than
 * discovering during one that the tablet was muted.
 *
 * The first press also unlocks audio for the page, which is the other reason
 * it earns its place in the header: browsers will not make a sound until
 * something has been clicked, and this gives that click somewhere to happen on
 * purpose.
 */
export function SoundCheck() {
  const { play, ready } = useChime();

  return (
    <button
      type="button"
      onClick={play}
      title={ready ? "Play the new-order alarm" : "Press to enable sound on this device"}
      className="flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-md border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface-muted"
    >
      {ready ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
      <span className="hidden sm:inline">{ready ? "Test alarm" : "Enable sound"}</span>
      <span className="sr-only">{ready ? "Play the new-order alarm" : "Enable sound on this device"}</span>
    </button>
  );
}
