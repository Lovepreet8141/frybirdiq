"use client";

import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUSY_SELECTOR,
  VERSION_POLL_MS,
  compareVersions,
  parseVersionBody,
  shouldAutoReload,
} from "@/lib/version/version-check";

/** The build baked into THIS bundle. */
const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const RELOADED_KEY = "frybird:version-check:auto-reloaded-at";

function busyNow(): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector(BUSY_SELECTOR)) return true;
  // Any filled-in text field, focused or not: an Admin form left half-edited must not be reloaded away.
  // Conservative on purpose: a search box with text also blocks the automatic reload (the tap still works).
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input")) {
    if (field instanceof HTMLInputElement && ["hidden", "checkbox", "radio", "button", "submit", "reset", "file", "range", "color"].includes(field.type)) continue;
    if (field.value !== "") return true;
  }
  return false;
}

function lastAutoReload(): number | null {
  try {
    const raw = window.sessionStorage.getItem(RELOADED_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/**
 * "New version — tap to reload", on every staff screen (mounted once in the
 * staff chrome: POS, KDS, orders board, Admin).
 *
 * Asks `/api/version` once a minute and whenever the tab becomes visible or
 * the connection returns. When the server's build differs from this bundle's,
 * a bar appears. If nobody has touched the screen for a minute and nothing is in
 * progress (no open dialog, no order being built, no half-typed text), it
 * reloads by itself; otherwise it waits and keeps offering the tap. A failed
 * check says nothing: it never prompts on doubt.
 */
export function VersionCheck() {
  const [stale, setStale] = useState(false);
  const lastTouch = useRef(0);

  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/version", { cache: "no-store" });
      if (!response.ok) return;
      setStale(compareVersions(MY_BUILD, parseVersionBody(await response.json())) === "newer");
    } catch {
      // Offline or the server is restarting: say nothing, ask again next time.
    }
  }, []);

  useEffect(() => {
    lastTouch.current = Date.now();
    const touch = () => {
      lastTouch.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    const timer = setInterval(() => void check(), VERSION_POLL_MS);
    const first = setTimeout(() => void check(), 0);
    return () => {
      clearTimeout(first);
      for (const name of events) window.removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
      clearInterval(timer);
    };
  }, [check]);

  useEffect(() => {
    if (!stale) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const go = shouldAutoReload({
        stale: true,
        idleMs: now - lastTouch.current,
        busy: busyNow(),
        online: navigator.onLine,
        lastAutoReloadAt: lastAutoReload(),
        now,
      });
      if (!go) return;
      try {
        window.sessionStorage.setItem(RELOADED_KEY, String(now));
      } catch {
        // No storage: the cooldown cannot be kept, so do not reload on our own.
        return;
      }
      window.location.reload();
    }, 5_000);
    return () => clearInterval(timer);
  }, [stale]);

  if (!stale) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] print:hidden">
      <button
        type="button"
        role="status"
        onClick={() => window.location.reload()}
        className="pointer-events-auto inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-border bg-inverse px-5 text-sm font-bold text-inverse-foreground shadow-lg"
      >
        <RotateCw className="size-4" aria-hidden="true" />
        New version — tap to reload
      </button>
    </div>
  );
}
