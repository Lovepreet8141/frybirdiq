import * as React from "react"

const MOBILE_BREAKPOINT = 768

// useSyncExternalStore rather than useState+useEffect: matchMedia is exactly
// the external-source-with-a-subscription shape it exists for, and it avoids
// the extra post-mount render a setState-in-an-effect approach needs while
// still rendering `false` (not mobile) on the server, correctly.
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
