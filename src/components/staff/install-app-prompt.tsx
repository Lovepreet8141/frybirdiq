"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The event Chrome/Android/Edge fire when the page qualifies as installable. Not in lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "frybird-install-prompt-dismissed";

type PromptState = "checking" | "installed" | "dismissed" | "installable" | "installing" | "installed-just-now" | "ios-manual" | "unsupported";

/**
 * Install FRYBIRD as an app on the rider's phone (Rider PWA). Shown only on the rider's own Deliveries screen: it is
 * the phone that has to stay open and awake while sharing location (`ShareLocation`, roadmap Lane B), so it is the
 * one screen worth pinning to a home-screen icon instead of a browser tab that can be swiped away by mistake.
 *
 * No install can be forced (§56 "disabled": explained, not hidden). Chrome/Android fires `beforeinstallprompt`,
 * which we hold until the rider taps Install. iOS Safari never fires it and has no programmatic install at all, so
 * there we can only explain the manual "Share → Add to Home Screen" steps. Either way this never blocks a delivery:
 * it is a banner beside the work, not a gate in front of it.
 */
export function InstallAppPrompt() {
  const [state, setState] = useState<PromptState>("checking");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Private browsing or blocked storage: treat as not dismissed — worst case the banner reappears.
    }
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (standalone) {
      queueMicrotask(() => setState("installed"));
      return;
    }
    if (dismissed) {
      queueMicrotask(() => setState("dismissed"));
      return;
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setState("installable");
    };
    const onInstalled = () => setState("installed");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Chrome fires beforeinstallprompt asynchronously, sometimes not at all (already dismissed too many times,
    // criteria not met yet); give it a moment before falling back to the iOS steps or hiding entirely.
    const fallback = window.setTimeout(() => {
      setState((current) => (current === "checking" ? (isIos ? "ios-manual" : "unsupported") : current));
    }, 1500);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(fallback);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Ignore: the banner just reappears next visit, which is safe.
    }
    setState("dismissed");
  }

  async function install() {
    if (!deferred) return;
    setState("installing");
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setState(outcome === "accepted" ? "installed-just-now" : "dismissed");
    } catch {
      setState("installable");
    }
    setDeferred(null);
  }

  if (state === "checking" || state === "installed" || state === "dismissed" || state === "unsupported") return null;

  if (state === "installed-just-now") {
    return (
      <p role="status" className="flex items-center gap-2.5 rounded-lg border border-gain bg-gain-soft/60 px-4 py-3 text-[13px]">
        <Download className="size-4 shrink-0 text-gain" aria-hidden="true" />
        Installed. Find FRYBIRD on your home screen — open it from there next time.
      </p>
    );
  }

  if (state === "ios-manual") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-panel px-4 py-3 text-[13px]">
        <Share className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-1 flex-col gap-1">
          <p className="font-semibold">Add FRYBIRD to your home screen</p>
          <p className="text-muted-foreground">Tap the Share button in Safari, then &ldquo;Add to Home Screen&rdquo;. Location sharing works from there too, and the screen won&rsquo;t lock while a delivery is out.</p>
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 whitespace-nowrap text-muted-foreground hover:text-foreground">
          Not now
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 text-[13px]">
      <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="font-semibold">Install FRYBIRD on this phone</p>
        <p className="text-muted-foreground">Opens like an app, and the screen won&rsquo;t lock while a delivery is out.</p>
      </div>
      <Button type="button" size="sm" onClick={install} disabled={state === "installing"}>
        {state === "installing" ? "Installing…" : "Install"}
      </Button>
      <button type="button" onClick={dismiss} className="shrink-0 whitespace-nowrap text-muted-foreground hover:text-foreground">
        Not now
      </button>
    </div>
  );
}
