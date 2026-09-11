"use client";

import { Rows2, Rows3 } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

/**
 * One product per row, or two.
 *
 * At 375px a single card is 324px wide and fills most of the screen, so
 * browsing forty-nine items means forty-nine screenfuls of scrolling. Two up
 * halves that and still leaves a 104px photo, which is enough to tell a burger
 * from a wrap.
 *
 * Two is the default because scanning is what a menu is for; one is there
 * because a bigger photo is genuinely better once you are choosing between two
 * things. The preference is remembered — it is about eyesight and habit, not
 * about this visit.
 *
 * Desktop is unaffected: the grid is two or three across from sm upward and
 * the control is hidden there, because a setting with no visible effect is
 * worse than no setting.
 *
 * localStorage is an external store, so it is read through
 * useSyncExternalStore rather than copied into state in an effect — the latter
 * renders once with the default and again with the real value, which is both a
 * wasted render and a visible flicker.
 */

const STORAGE_KEY = "frybird:menu-density";
const EVENT = "frybird:density";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  // Another tab changing it should not leave this one disagreeing.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStored(): "1" | "2" {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1" ? "1" : "2";
  } catch {
    // Private mode, or site data blocked. Two up is the default.
    return "2";
  }
}

/** The server has no preference to read, so it renders the default. */
function serverSnapshot(): "1" | "2" {
  return "2";
}

export function DensityToggle() {
  const density = useSyncExternalStore(subscribe, readStored, serverSnapshot);

  const choose = useCallback((next: "1" | "2") => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Not persisted. The attribute below still applies for this visit. */
    }
    document.documentElement.dataset.menuDensity = next;
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return (
    <div
      role="group"
      aria-label="Items per row"
      className="flex shrink-0 overflow-hidden rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] shadow-[3px_3px_0_var(--ink)] sm:hidden"
    >
      {([
        { value: "1", label: "One per row", Icon: Rows2, rotate: false },
        { value: "2", label: "Two per row", Icon: Rows3, rotate: true },
      ] as const).map(({ value, label, Icon, rotate }) => {
        const active = density === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            aria-pressed={active}
            aria-label={label}
            className={`flex size-[44px] cursor-pointer items-center justify-center transition-colors duration-200 ${
              active ? "bg-[var(--red)] text-[var(--cream-hi)]" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <Icon className={rotate ? "size-4 rotate-90" : "size-4"} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
