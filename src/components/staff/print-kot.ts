/**
 * Opens the kitchen ticket for printing.
 *
 * The window opens synchronously, before any `await` — that is what keeps a
 * popup blocker from treating it as an unrelated pop-up, since blockers key
 * off whether `window.open` ran inside the same tick as the user gesture,
 * not off whether the surrounding function is technically a click handler.
 * Call `openKotWindow()` first, then `commit`/`cancel` once the action that
 * justified it has actually succeeded or failed.
 */
export function openKotWindow(): { commit: (orderId: string) => void; cancel: () => void } {
  const win = typeof window === "undefined" ? null : window.open("about:blank", "_blank", "width=420,height=640");

  return {
    commit(orderId: string) {
      const url = `/app/orders/${orderId}/kot`;
      if (win) win.location.href = url;
      // The synchronous open can still fail (blocked, disabled pop-ups) —
      // falling back to a normal open at least tries, even though this one
      // may itself be blocked without a fresh gesture.
      else window.open(url, "_blank");
    },
    cancel() {
      win?.close();
    },
  };
}
