"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A chime that actually plays.
 *
 * Browsers refuse to start an AudioContext until the page has had a real user
 * gesture, and Safari is stricter than Chrome: the context must be resumed
 * *inside* the gesture handler, and on iOS it stays silent until a buffer has
 * been played from one. Creating the context when an order arrives is too
 * late — there is no gesture in a `setInterval`.
 *
 * So the context is unlocked once, on the first interaction anywhere on the
 * page, and kept. After that a chime can be played from a timer.
 *
 * `ready` is false until that has happened, so the interface can ask for a tap
 * rather than quietly playing nothing — a chime nobody can hear is the one
 * failure this must not have.
 */
export function useChime() {
  const context = useRef<AudioContext | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let done = false;

    const unlock = async () => {
      if (done) return;
      try {
        const Ctor: typeof AudioContext =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;

        context.current ??= new Ctor();
        // Must happen inside the gesture, not after an await.
        void context.current.resume();

        // iOS Safari needs a buffer to have played from a gesture before it
        // will produce sound from anywhere else. Silent, one sample.
        const buffer = context.current.createBuffer(1, 1, 22_050);
        const source = context.current.createBufferSource();
        source.buffer = buffer;
        source.connect(context.current.destination);
        source.start(0);

        done = true;
        setReady(true);
        remove();
      } catch {
        // No audio on this device. The visible alert still does its job.
      }
    };

    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const remove = () => events.forEach((event) => window.removeEventListener(event, unlock));
    events.forEach((event) => window.addEventListener(event, unlock, { passive: true }));

    return remove;
  }, []);

  const play = useCallback(() => {
    const ctx = context.current;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    // Two short rising notes: audible across a kitchen, short enough not to
    // become the thing everyone wants switched off.
    for (const [index, offset] of [0, 0.18].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = index === 0 ? 880 : 1180;
      const at = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    }
  }, []);

  return { play, ready };
}
