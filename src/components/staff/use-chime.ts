"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The new-order alarm.
 *
 * Deliberately an alarm and not a chime. A soft tone every twenty seconds is a
 * doorbell — pleasant, and completely lost under an extractor fan and a fryer.
 * This is meant to be heard across a kitchen by someone who is not looking at
 * the screen, and to keep being heard until somebody deals with it.
 *
 * A square wave rather than a sine: the odd harmonics cut through broadband
 * noise in a way a pure tone does not, at the same measured loudness. It is
 * the reason smoke alarms do not use sine waves.
 *
 * ## Why the unlock dance
 *
 * Browsers refuse to start an AudioContext until the page has had a real user
 * gesture, and Safari is stricter than Chrome: resume() must be called inside
 * the gesture handler rather than after an await, and on iOS a buffer has to
 * have played from one before anything else will sound. There is no gesture
 * inside a setInterval, so the context is unlocked once on the first
 * interaction anywhere and kept.
 */

/** Peak gain per pulse. Loud, short of clipping once the pulses overlap. */
const PULSE_GAIN = 0.55;
/** Pulses in one burst. */
const PULSES = 3;
/** Length of each pulse and the gap after it. */
const PULSE_S = 0.13;
const GAP_S = 0.09;

export function useChime() {
  const context = useRef<AudioContext | null>(null);
  const master = useRef<GainNode | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let done = false;

    const unlock = () => {
      if (done) return;
      try {
        const Ctor: typeof AudioContext =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;

        const ctx = context.current ?? new Ctor();
        context.current = ctx;
        // Inside the gesture, not after an await. Safari cares.
        void ctx.resume();

        // One shared output, so overlapping pulses cannot sum into clipping.
        if (!master.current) {
          const gain = ctx.createGain();
          gain.gain.value = 0.9;
          gain.connect(ctx.destination);
          master.current = gain;
        }

        // iOS Safari needs a buffer to have played from a gesture before it
        // will produce sound from anywhere else. Silent, one sample.
        const buffer = ctx.createBuffer(1, 1, 22_050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);

        done = true;
        setReady(true);
        remove();
      } catch {
        // No audio on this device. The dialog still does its job.
      }
    };

    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const remove = () => events.forEach((event) => window.removeEventListener(event, unlock));
    events.forEach((event) => window.addEventListener(event, unlock, { passive: true }));

    return remove;
  }, []);

  /**
   * One burst: three hard pulses alternating between two pitches.
   *
   * Two pitches rather than one because an alternating pair reads as an alarm
   * and a repeated single note reads as a fault — and a two-tone pattern stays
   * audible when one of the frequencies happens to sit in a null of the room.
   */
  const play = useCallback(() => {
    const ctx = context.current;
    const out = master.current;
    if (!ctx || !out) return;
    if (ctx.state === "suspended") void ctx.resume();

    for (let index = 0; index < PULSES; index++) {
      const at = ctx.currentTime + index * (PULSE_S + GAP_S);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = index % 2 === 0 ? 988 : 1319; // B5 and E6

      // A hard edge on and off. A slow ramp is what made the old one sound
      // soft and far away.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PULSE_GAIN, at + 0.005);
      gain.gain.setValueAtTime(PULSE_GAIN, at + PULSE_S - 0.01);
      gain.gain.linearRampToValueAtTime(0, at + PULSE_S);

      osc.connect(gain).connect(out);
      osc.start(at);
      osc.stop(at + PULSE_S + 0.01);
    }
  }, []);

  /** How long one burst lasts, so a caller can space them sensibly. */
  const burstSeconds = PULSES * (PULSE_S + GAP_S);

  return { play, ready, burstSeconds };
}
