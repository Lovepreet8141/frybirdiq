"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the tablet has a connection.
 *
 * Every mutation on the POS is priced by a Server Action, so offline is not
 * a degraded mode here — it is the one state where nothing can be added.
 * §57 requires the screen to say so, not just fail quietly on the next tap.
 *
 * `navigator.onLine` is state the browser owns, not React's — exactly what
 * `useSyncExternalStore` is for, rather than mirroring it into a `useState`
 * from inside an effect.
 */
function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

/** The server has no network to be offline from. Assume connected until proven otherwise. */
function getServerSnapshot(): boolean {
  return true;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
